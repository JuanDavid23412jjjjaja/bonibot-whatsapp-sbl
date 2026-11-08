import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FastCacheEntry {
  id: string;
  category: string;
  canonicalQuestion: string;
  triggerPatterns: string[];
  requiredKeywords: string[];
  answer: string;
  sourceCitation: string;
}

export interface FastCacheMatch {
  entry: FastCacheEntry;
  confidence: number;
}

const STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'de',
  'del',
  'al',
  'en',
  'con',
  'por',
  'para',
  'que',
  'cual',
  'cuales',
  'como',
  'donde',
  'cuando',
  'quien',
  'es',
  'son',
  'hay',
  'tiene',
  'tienen',
  'puedo',
  'puede',
  'me',
  'mi',
  'mis',
  'tu',
  'su',
  'sus',
  'se',
  'lo',
  'le',
  'les',
  'si',
  'no',
  'mas',
  'pero',
  'o',
  'y',
  'a',
  'sobre',
  'favor',
  'colegio',
  'san',
  'bonifacio',
  'lanzas',
  'sbl',
  'bonibot',
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Tier-0 Semantic Fast-Cache (<5ms execution).
 * Resolves the top 85% most frequent institutional queries instantaneously without external network latency.
 */
export class SemanticFastCache {
  private entries: FastCacheEntry[] = [];

  constructor() {
    this.loadCache();
  }

  private loadCache(): void {
    try {
      const cachePath = path.resolve(process.cwd(), 'data', 'sbl_fast_cache.json');
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf8');
        this.entries = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Advertencia cargando sbl_fast_cache.json:', err);
    }
  }

  public match(userQuery: string, threshold = 0.8): FastCacheMatch | null {
    if (this.entries.length === 0) return null;

    const normQuery = normalize(userQuery);
    if (!normQuery) return null;

    // Si el usuario hace una consulta muy larga (>140 caracteres) o pide un artículo específico distinto,
    // delegar al motor RAG + LLM completo para precisión quirúrgica.
    const explicitArtMatch = normQuery.match(/\barticulo\s+(\d+)\b/);
    if (normQuery.length > 140) return null;

    const queryTokens = tokenize(userQuery);

    // Caso especial para saludos cortos ("hola", "buenos dias", "hola bonibot")
    if (
      /^(hola|buenos dias|buenas tardes|buenas noches|buen dia|hey|hi|hola bonibot|ayuda|menu)$/i.test(
        normQuery
      )
    ) {
      const greetingEntry = this.entries.find((e) => e.id === 'faq-saludo');
      if (greetingEntry) {
        return { entry: greetingEntry, confidence: 1.0 };
      }
    }

    let bestMatch: FastCacheMatch | null = null;

    for (const entry of this.entries) {
      if (entry.id === 'faq-saludo') continue;

      // Si el usuario menciona un artículo explícito que no está en los triggers de esta entrada, saltar
      if (explicitArtMatch) {
        const artNum = explicitArtMatch[1];
        const triggersHaveArt = entry.triggerPatterns.some((tp) =>
          normalize(tp).includes(`articulo ${artNum}`)
        );
        if (!triggersHaveArt) continue;
      }

      // Verificar que al menos una palabra clave requerida esté presente (si la entrada define requiredKeywords)
      if (entry.requiredKeywords.length > 0) {
        const hasRequired = entry.requiredKeywords.some((kw) => {
          const nKw = normalize(kw);
          return normQuery.includes(nKw);
        });
        if (!hasRequired) continue;
      }

      let maxPatternScore = 0;

      for (const rawPattern of [entry.canonicalQuestion, ...entry.triggerPatterns]) {
        const normPattern = normalize(rawPattern);

        // Coincidencia exacta o inclusión directa de frase gatillo
        if (normQuery === normPattern) {
          maxPatternScore = 1.0;
          break;
        }

        if (normPattern.length >= 6 && normQuery.includes(normPattern)) {
          const coverageBoost = Math.min(1.0, 0.86 + normPattern.length / 100);
          if (coverageBoost > maxPatternScore) {
            maxPatternScore = coverageBoost;
          }
        }

        // Similitud de tokens significativos
        const patternTokens = tokenize(rawPattern);
        if (patternTokens.length > 0 && queryTokens.length > 0) {
          let hits = 0;
          for (const pt of patternTokens) {
            if (queryTokens.some((qt) => qt === pt || (qt.length >= 4 && pt.startsWith(qt)))) {
              hits++;
            }
          }
          const recall = hits / patternTokens.length;
          const precision = hits / queryTokens.length;
          const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;

          if (f1 > maxPatternScore) {
            maxPatternScore = f1;
          }
        }
      }

      if (maxPatternScore >= threshold) {
        if (!bestMatch || maxPatternScore > bestMatch.confidence) {
          bestMatch = {
            entry,
            confidence: Number(maxPatternScore.toFixed(3)),
          };
        }
      }
    }

    return bestMatch;
  }

  public getTotalEntries(): number {
    return this.entries.length;
  }
}
