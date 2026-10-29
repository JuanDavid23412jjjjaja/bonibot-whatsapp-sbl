import { env } from '../config/env.js';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  errorsEncountered: string[];
}

interface ProviderHandler {
  name: string;
  model: string;
  isConfigured: () => boolean;
  call: (messages: ChatTurn[], signal: AbortSignal) => Promise<string>;
}

/**
 * Multi-LLM Router with automatic fallback across:
 * 1. Google Gemini (AI Studio)
 * 2. Groq Cloud
 * 3. OpenRouter (:free models)
 * 4. NVIDIA NIM API
 */
export class MultiLLMRouter {
  private providers: ProviderHandler[];
  private timeoutMs: number;

  constructor(timeoutMs = 60000) {
    this.timeoutMs = timeoutMs;
    this.providers = [
      {
        name: 'NVIDIA NIM',
        model: env.nvidia.model,
        isConfigured: () => Boolean(env.nvidia.apiKey),
        call: (messages, signal) =>
          this.callOpenAICompatible(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            env.nvidia.apiKey,
            env.nvidia.model,
            messages,
            signal
          ),
      },
      {
        name: 'Google Gemini',
        model: env.gemini.model,
        isConfigured: () => Boolean(env.gemini.apiKey),
        call: (messages, signal) => this.callGemini(messages, signal),
      },
      {
        name: 'Groq Cloud',
        model: env.groq.model,
        isConfigured: () => Boolean(env.groq.apiKey),
        call: (messages, signal) =>
          this.callOpenAICompatible(
            'https://api.groq.com/openai/v1/chat/completions',
            env.groq.apiKey,
            env.groq.model,
            messages,
            signal
          ),
      },
      {
        name: 'OpenRouter',
        model: env.openrouter.model,
        isConfigured: () => Boolean(env.openrouter.apiKey),
        call: (messages, signal) =>
          this.callOpenAICompatible(
            'https://openrouter.ai/api/v1/chat/completions',
            env.openrouter.apiKey,
            env.openrouter.model,
            messages,
            signal,
            {
              'HTTP-Referer': 'https://sanboni.edu.co',
              'X-Title': 'BoniBot SBL WhatsApp Assistant',
            }
          ),
      },
    ];
  }

  public getActiveProviders(): Array<{ name: string; model: string }> {
    return this.providers
      .filter((p) => p.isConfigured())
      .map((p) => ({ name: p.name, model: p.model }));
  }

  public async generate(messages: ChatTurn[]): Promise<LLMResponse> {
    const active = this.providers.filter((p) => p.isConfigured());
    const errorsEncountered: string[] = [];

    if (active.length === 0) {
      throw new Error(
        'No hay ninguna API Key de LLM configurada en el archivo .env (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY o NVIDIA_API_KEY).'
      );
    }

    for (let i = 0; i < active.length; i++) {
      const provider = active[i];
      const startTime = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const text = await provider.call(messages, controller.signal);
        clearTimeout(timer);

        if (text && text.trim().length > 0) {
          return {
            text: text.trim(),
            provider: provider.name,
            model: provider.model,
            latencyMs: Date.now() - startTime,
            fallbackUsed: i > 0,
            errorsEncountered,
          };
        }
        errorsEncountered.push(`${provider.name}: Respuesta vacía`);
      } catch (err: unknown) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        errorsEncountered.push(`${provider.name} (${provider.model}): ${msg}`);
      }
    }

    throw new Error(
      `Todos los proveedores LLM configurados fallaron:\n- ${errorsEncountered.join('\n- ')}`
    );
  }

  private async callGemini(messages: ChatTurn[], signal: AbortSignal): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMsgs = messages.filter((m) => m.role !== 'system');

    const contents = chatMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.gemini.model}:generateContent?key=${env.gemini.apiKey}`;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 1024,
      },
    };

    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg.content }],
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  private async callOpenAICompatible(
    endpoint: string,
    apiKey: string,
    model: string,
    messages: ChatTurn[],
    signal: AbortSignal,
    extraHeaders: Record<string, string> = {}
  ): Promise<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.25,
        max_tokens: 700,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return data.choices?.[0]?.message?.content || '';
  }
}
