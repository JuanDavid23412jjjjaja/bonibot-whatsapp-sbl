import { SemanticFastCache } from '../cache/semanticCache.js';
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
  private fastCache: SemanticFastCache;
  private retriever: HybridRetriever;
  private memory: SessionMemory;
  private router: MultiLLMRouter;

  constructor() {
    this.fastCache = new SemanticFastCache();
    this.retriever = new HybridRetriever();
    this.memory = new SessionMemory(8);
    this.router = new MultiLLMRouter(8000);
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

    // 2. Tier-0: Fast Semantic Cache (<10ms respuesta instantánea para preguntas institucionales frecuentes)
    const fastMatch = this.fastCache.match(text, 0.8);
    if (fastMatch) {
      await this.memory.appendTurn(phoneNumber, text, fastMatch.entry.answer);
      return {
        replyText: fastMatch.entry.answer,
        providerUsed: 'FastCache ML SBL (Instantáneo)',
        modelUsed: `sbl-faq-v1 (conf=${fastMatch.confidence})`,
        latencyMs: Date.now() - startTime,
        retrievedChunks: [],
      };
    }

    // 3. Retrieve relevant institutional chunks (Hybrid RAG - Top 3 más precisos)
    const retrievedChunks = await this.retriever.retrieve(text, 3);

    // 4. Load recent conversation history for this phone number
    const history = await this.memory.getHistory(phoneNumber);

    // 5. Check if at least one LLM provider is configured
    const activeProviders = this.router.getActiveProviders();
    if (activeProviders.length === 0) {
      const fallbackText =
        retrievedChunks.length > 0
          ? [
              '🦊 *BoniBot (Modo Respuesta Directa RAG SBL):*',
              ...retrievedChunks
                .slice(0, 2)
                .map(
                  (c, i) =>
                    `*${i + 1}. ${c.source} (${c.section}):*\n${c.content
                      .replace(/^\[Fuente:[^\]]+\]\n?/, '')
                      .slice(0, 650)}...`
                ),
            ].join('\n\n')
          : '🦊 No encontré fragmentos relacionados en la base oficial del colegio.';

      return {
        replyText: fallbackText,
        providerUsed: 'RAG Extractivo Local',
        modelUsed: 'BM25+Sinónimos',
        latencyMs: Date.now() - startTime,
        retrievedChunks,
      };
    }

    // 6. Build prompt and call Multi-LLM Router (HF ML ➔ Gemini ➔ Gemini Lite ➔ Groq)
    const systemPrompt = buildSystemPrompt(retrievedChunks);
    const messages: ChatTurn[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: text },
    ];

    try {
      const llmResult = await this.router.generate(messages);
      await this.memory.appendTurn(phoneNumber, text, llmResult.text);

      return {
        replyText: llmResult.text,
        providerUsed: llmResult.provider + (llmResult.fallbackUsed ? ' (Fallback)' : ''),
        modelUsed: llmResult.model,
        latencyMs: llmResult.latencyMs,
        retrievedChunks,
      };
    } catch (err) {
      console.warn('Fallback a RAG Extractivo directo por saturación de APIs:', err);
      const directRagReply =
        retrievedChunks.length > 0
          ? [
              '🦊 *Información Oficial del Colegio San Bonifacio de las Lanzas:*',
              ...retrievedChunks
                .slice(0, 2)
                .map(
                  (c) =>
                    `📌 *${c.source} (${c.section}):*\n${c.content
                      .replace(/^\[Fuente:[^\]]+\]\n?/, '')
                      .slice(0, 700)}`
                ),
            ].join('\n\n')
          : '🦊 ¡Hola! En este momento estoy experimentando alta demanda. Por favor intenta tu consulta nuevamente en unos segundos.';

      return {
        replyText: directRagReply,
        providerUsed: 'RAG Extractivo Directo (Respaldo)',
        modelUsed: 'BM25+Sinónimos',
        latencyMs: Date.now() - startTime,
        retrievedChunks,
      };
    }
  }
}
