import fs from 'fs/promises';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env.js';
import { KnowledgeChunk } from './chunker.js';
import { cosineSimilarity, generateEmbedding } from '../llm/embeddings.js';

export interface RetrievedChunk extends KnowledgeChunk {
  score: number;
}

const SPANISH_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en',
  'con', 'por', 'para', 'sin', 'sobre', 'entre', 'y', 'o', 'u', 'e', 'que', 'quien',
  'como', 'cuando', 'donde', 'cual', 'cuales', 'cuanto', 'cuanta', 'es', 'son', 'fue',
  'ser', 'estar', 'esta', 'este', 'estos', 'estas', 'ese', 'esa', 'mi', 'tu', 'su',
  'mis', 'tus', 'sus', 'me', 'te', 'se', 'nos', 'le', 'les', 'lo', 'si', 'no', 'mas',
  'pero', 'porque', 'muy', 'hay', 'tiene', 'tienen', 'puedo', 'puede', 'pueden', 'hacer',
  'hola', 'buenos', 'dias', 'tardes', 'noches', 'favor', 'gracias', 'colegio', 'san',
  'bonifacio', 'lanzas', 'sbl', 'sanboni', 'hijo', 'hija', 'estudiante', 'estudiantes',
  'ano', 'dia', 'niños', 'ninos'
]);

/**
 * Domain-specific synonym expansion for SBL (San Bonifacio de las Lanzas) queries
 * so colloquial parent/student questions hit the exact legal/institutional terms.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  pension: ['pensiones', 'mensualidad', 'valor de la pension', 'recargo', 'extemporaneidad', 'articulo 125', 'articulo 126'],
  mensualidad: ['pension', 'valor de la pension', 'articulo 125', 'articulo 126'],
  cuesta: ['valor de la matricula', 'valor de la pension', 'cobros periodicos', 'articulo 122', 'articulo 126', 'articulo 127'],
  matricula: ['valor de la matricula', 'tipos de matricula', 'requisitos', 'articulo 119', 'articulo 121', 'articulo 122'],
  seguro: ['poliza', 'mundial', 'accidente', 'clinica', 'urgencias', '2000694412', 'asotrauma', 'amparos'],
  poliza: ['seguro', 'mundial', 'accidente', 'clinica', '2000694412', 'asotrauma'],
  accidente: ['poliza', 'seguro', 'primeros auxilios', 'enfermeria', 'asotrauma', '2000694412'],
  clinica: ['poliza', 'seguro', 'asotrauma', 'idime', 'avidanti', 'keralty', 'federico lleras', 'dentoman'],
  uniforme: ['uniformes', 'gala', 'diario', 'sudadera', 'camibuso', 'falda', 'natacion', 'jeans day', 'articulo 4', 'articulo 5', 'articulo 25'],
  tarde: ['procedimiento de llegadas tarde', 'puntualidad', 'horario escolar', 'articulo 22', 'articulo 131'],
  horario: ['horario escolar', 'ingreso', 'salida', 'horario de almuerzo', 'exploratorio', 'conceptual', 'contextual', 'proyectivo', 'articulo 131', 'articulo 132'],
  almuerzo: ['servicio de alimentacion', 'horario de almuerzo', 'menu', 'coliseo', '4.150.000', 'articulo 91', 'articulo 127', 'articulo 132'],
  celular: ['dispositivos electronicos personales', 'resguardo', 'articulo 26', 'articulo 13'],
  copia: ['fraude', 'plagio', 'inteligencia artificial', 'anulacion', 'articulo 24'],
  permiso: ['procedimiento solicitud permisos', 'ausencia', 'incapacidad', 'excusa', 'articulo 133'],
  nota: ['escala de valoracion', 'niveles de idoneidad', 'inicial', 'esperado', 'avanzado', 'excelencia', 'articulo 5'],
  perder: ['no promovidos', 'nivelacion remedial', 'criterios de promocion', 'articulo 2', 'articulo 3'],
  nivelacion: ['estrategia de nivelacion', 'nivelacion remedial', 'catch up week', 'articulo 10', 'articulo 3'],
  graduarse: ['criterios de promocion', 'titulo de bachiller', 'ielts', 'band score 6.0', '80 horas', 'servicio social', 'articulo 2'],
  once: ['undecimo', 'titulo de bachiller', 'ielts', 'band score 6.0', '80 horas'],
  ielts: ['b2', '6.0', 'band score', 'pruebas estandarizadas', 'undecimo', 'articulo 2', 'articulo 11'],
  servicio: ['servicio social obligatorio', '80 horas', 'carlo acutis', 'articulo 74', 'articulo 2'],
  carlo: ['proyecto carlo acutis', 'servicio social', 'comuna 6', 'plan padrino', 'mini bazar', '312 453 4990', 'articulo 73'],
  medicamento: ['primeros auxilios', 'enfermera', 'orden medica', 'articulo 82'],
  vacaciones: ['calendario escolar', 'cronograma academico', 'semana santa', 'semana de receso', 'articulo 130'],
  robotica: ['talleres activate', 'technoscience', 'juan david', 'impresora 3d'],
  technoscience: ['juan david', 'robotica', 'mentorias academicas'],
};

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenizeQuery(query: string): { coreTokens: string[]; synonymPhrases: string[] } {
  const norm = normalizeText(query);
  const rawTokens = norm.split(/[^a-z0-9.]+/).filter((t) => t.length >= 2);
  const coreTokens = Array.from(new Set(rawTokens.filter((t) => !SPANISH_STOPWORDS.has(t))));

  const synonymPhrases = new Set<string>();
  for (const token of coreTokens) {
    for (const [key, syns] of Object.entries(SYNONYM_MAP)) {
      if (token === key || (token.length >= 4 && (token.includes(key) || key.includes(token)))) {
        syns.forEach((s) => synonymPhrases.add(normalizeText(s)));
      }
    }
  }
  return { coreTokens, synonymPhrases: Array.from(synonymPhrases) };
}

export class HybridRetriever {
  private localChunks: KnowledgeChunk[] = [];
  private loadedLocal = false;
  private supabase: SupabaseClient | null = null;

  constructor() {
    if (isSupabaseConfigured()) {
      this.supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey);
    }
  }

  private async ensureLocalLoaded(): Promise<void> {
    if (this.loadedLocal) return;
    const kbPath = path.resolve(process.cwd(), 'data', 'knowledge_base.json');
    try {
      const raw = await fs.readFile(kbPath, 'utf-8');
      this.localChunks = JSON.parse(raw) as KnowledgeChunk[];
      this.loadedLocal = true;
    } catch {
      this.localChunks = [];
    }
  }

  public async getStats(): Promise<{ totalChunks: number; mode: string }> {
    await this.ensureLocalLoaded();
    return {
      totalChunks: this.localChunks.length,
      mode: this.supabase ? 'Supabase pgvector + Local Hybrid Fallback' : 'Local Hybrid Index (BM25 + Sinónimos SBL)',
    };
  }

  public async retrieve(query: string, topK = 6): Promise<RetrievedChunk[]> {
    // 1. Try Supabase Hybrid RPC if configured
    if (this.supabase) {
      try {
        const queryEmb = await generateEmbedding(query);
        if (queryEmb) {
          const { data, error } = await this.supabase.rpc('match_sbl_documents', {
            query_embedding: queryEmb,
            query_text: query,
            match_count: topK,
          });

          if (!error && Array.isArray(data) && data.length > 0) {
            return data.map((row: Record<string, unknown>) => ({
              id: String(row.id),
              source: String(row.source || 'SBL'),
              section: String(row.section || ''),
              content: String(row.content || ''),
              metadata: (row.metadata as KnowledgeChunk['metadata']) || { type: 'pdf' },
              score: Number(row.similarity || 0.8),
            }));
          }
        }
      } catch {
        // Fallback seamlessly to local hybrid index
      }
    }

    // 2. Local Hybrid Search (Core Token IDF + Synonym Phrase Boost + Diversity Filter)
    await this.ensureLocalLoaded();
    if (this.localChunks.length === 0) return [];

    const normQuery = normalizeText(query);
    const { coreTokens, synonymPhrases } = tokenizeQuery(query);

    const explicitArtMatch = normQuery.match(/art(?:iculo)?\.?\s*(\d+)/);
    const explicitArticleNum = explicitArtMatch ? parseInt(explicitArtMatch[1], 10) : null;

    const hasLocalVectors = this.localChunks.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
    const queryEmbedding = hasLocalVectors ? await generateEmbedding(query) : null;

    const scored: RetrievedChunk[] = this.localChunks.map((chunk) => {
      const normContent = normalizeText(chunk.content);
      const normSection = normalizeText(chunk.section);
      let lexicalScore = 0;
      let distinctCoreMatches = 0;

      if (explicitArticleNum !== null && chunk.metadata.articleNumber === explicitArticleNum) {
        lexicalScore += 30;
      }

      // Score core user tokens (highest weight + coverage bonus when a chunk matches multiple distinct words)
      for (const token of coreTokens) {
        if (!token) continue;
        let idx = normContent.indexOf(token);
        let count = 0;
        while (idx !== -1 && count < 5) {
          count++;
          idx = normContent.indexOf(token, idx + token.length);
        }
        if (count > 0) {
          distinctCoreMatches++;
          lexicalScore += (1.5 + Math.log(count)) * (token.length >= 5 ? 2.5 : 1.5);
        }
        if (normSection.includes(token)) {
          lexicalScore += 4.5;
        }
      }

      // Multi-term coverage bonus
      if (distinctCoreMatches >= 2) {
        lexicalScore += distinctCoreMatches * 3.0;
      }

      // Score synonym phrases
      for (const phrase of synonymPhrases) {
        if (normSection.includes(phrase)) {
          lexicalScore += 6.0;
        } else if (normContent.includes(phrase)) {
          lexicalScore += 2.5;
        }
      }

      let vectorScore = 0;
      if (queryEmbedding && chunk.embedding) {
        vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding)) * 18;
      }

      return {
        ...chunk,
        score: lexicalScore + vectorScore,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Diversity filter: allow at most 1 sub-part per specific Article or CSV group so multi-topic questions get all relevant articles
    const diverseResults: RetrievedChunk[] = [];
    const seenGroupKeys = new Map<string, number>();

    for (const candidate of scored) {
      if (candidate.score <= 0) break;
      const groupKey = candidate.metadata.articleNumber
        ? `${candidate.source}-art-${candidate.metadata.articleNumber}`
        : candidate.id;

      const currentCount = seenGroupKeys.get(groupKey) || 0;
      if (currentCount < 1) {
        diverseResults.push(candidate);
        seenGroupKeys.set(groupKey, currentCount + 1);
      }
      if (diverseResults.length >= topK) break;
    }

    return diverseResults;
  }
}
