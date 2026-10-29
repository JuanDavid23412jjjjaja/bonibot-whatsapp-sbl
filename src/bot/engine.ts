import { getConfiguredLLMProviders } from '../config/env.js';
import { ChatTurn, MultiLLMRouter } from '../llm/router.js';
import { SessionMemory } from '../memory/session.js';
import { buildSystemPrompt } from '../rag/prompt.js';
import { HybridRetriever, RetrievedChunk } from '../rag/retriever.js';

export interface BotReply {
  replyText: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  retrievedChunks: RetrievedChunk[];
}

export class BoniBotEngine {
  private retriever: HybridRetriever;
  private memory: SessionMemory;
  private router: MultiLLMRouter;

  constructor() {
    this.retriever = new HybridRetriever();
    this.memory = new SessionMemory(8);
    this.router = new MultiLLMRouter(60000);
  }

  public async handleMessage(phoneNumber: string, incomingText: string): Promise<BotReply> {
    const text = incomingText.trim();
    const startTime = Date.now();

    // 1. Check special commands
    if (/^\/(reset|borrar|nuevo)$/i.test(text)) {
      await this.memory.clearHistory(phoneNumber);
      return {
        replyText:
          '🧹 *Memoria reiniciada.* He borrado el historial reciente de nuestra conversación. ¿En qué te puedo ayudar hoy sobre el Colegio San Bonifacio de las Lanzas?',
        providerUsed: 'Sistema Interno',
        modelUsed: 'CommandHandler',
        latencyMs: Date.now() - startTime,
        retrievedChunks: [],
      };
    }

    if (/^\/(estado|status)$/i.test(text)) {
      const stats = await this.retriever.getStats();
      const providers = getConfiguredLLMProviders();
      return {
        replyText: [
          '🦊 *Estado del Sistema BoniBot (SBL)*',
          `• *Motor RAG:* ${stats.mode}`,
          `• *Fragmentos indexados:* ${stats.totalChunks} bloques oficiales`,
          `• *Proveedores LLM activos:* ${
            providers.length > 0 ? providers.join(' ➔ ') : 'Ninguno (Modo RAG Directo activo)'
          }`,
        ].join('\n'),
        providerUsed: 'Sistema Interno',
        modelUsed: 'StatusHandler',
        latencyMs: Date.now() - startTime,
        retrievedChunks: [],
      };
    }

    // 2. Retrieve relevant institutional chunks (Hybrid RAG - Top 3 más precisos)
    const retrievedChunks = await this.retriever.retrieve(text, 3);

    // 3. Load recent conversation history for this phone number
    const history = await this.memory.getHistory(phoneNumber);

    // 4. Check if at least one LLM provider is configured
    const activeProviders = this.router.getActiveProviders();
    if (activeProviders.length === 0) {
      // Graceful Extractive RAG mode when user hasn't pasted an API key yet
      const fallbackText =
        retrievedChunks.length > 0
          ? [
              '🦊 *BoniBot (Modo Vista Previa RAG — Sin API Key LLM aún):*',
              'Encontré estos fragmentos oficiales exactos para tu consulta:\n',
              ...retrievedChunks
                .slice(0, 3)
                .map(
                  (c, i) =>
                    `*${i + 1}. ${c.source} (${c.section}):*\n${c.content
                      .replace(/^\[Fuente:[^\]]+\]\n?/, '')
                      .slice(0, 650)}...`
                ),
              '\n💡 _Agrega tu `GEMINI_API_KEY` o `GROQ_API_KEY` en el archivo `.env` para que el LLM redacte la respuesta conversacional._',
            ].join('\n\n')
          : '🦊 No encontré fragmentos relacionados y aún no hay una API Key de LLM configurada en `.env`.';

      return {
        replyText: fallbackText,
        providerUsed: 'RAG Extractivo Local (Sin API Key)',
        modelUsed: 'BM25+Sinónimos',
        latencyMs: Date.now() - startTime,
        retrievedChunks,
      };
    }

    // 5. Build prompt and call Multi-LLM Router with fallback
    const systemPrompt = buildSystemPrompt(retrievedChunks);
    const messages: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    const llmResult = await this.router.generate(messages);

    // 6. Save turn to conversation memory
    await this.memory.appendTurn(phoneNumber, text, llmResult.text);

    return {
      replyText: llmResult.text,
      providerUsed: llmResult.provider + (llmResult.fallbackUsed ? ' (Fallback)' : ''),
      modelUsed: llmResult.model,
      latencyMs: llmResult.latencyMs,
      retrievedChunks,
    };
  }
}
