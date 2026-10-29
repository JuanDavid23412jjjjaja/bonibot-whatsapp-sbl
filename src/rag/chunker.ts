import fs from 'fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

export interface KnowledgeChunk {
  id: string;
  source: string;
  section: string;
  content: string;
  metadata: {
    type: 'pdf' | 'markdown' | 'csv';
    articleNumber?: number;
    pageHint?: string;
    keywords?: string[];
  };
  embedding?: number[];
}

/**
 * Normalizes extracted PDF text by inserting structural line breaks before
 * TÍTULO, CAPÍTULO, Artículo X., Parágrafo, etc., so chunking works cleanly
 * even when PDF text items are joined by spaces.
 */
function normalizePdfStructure(pages: string[]): string {
  const cleanedPages = pages.map((pageText, idx) => {
    // Skip pure Table of Contents pages (pages 2-3 of SIEE or pages 4-6 of Pacto)
    if (idx < 7 && /(Tabla de contenido|ÍNDICE\s+ÍTEM\s+PÁGINA)/i.test(pageText)) {
      return '';
    }
    return pageText
      .replace(/Pacto de Convivencia\s+2026\s+\d+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  });

  const joined = cleanedPages.filter(Boolean).join('\n\n');

  // Insert newlines before structural headings
  return joined
    .replace(/\s+(TÍTULO\s+[IVXLCDM]+\b)/g, '\n\n$1')
    .replace(/\s+(CAPÍTULO\s+[IVXLCDM]+\b)/gi, '\n\n$1')
    .replace(/\s+(Artículo\s+\d+\s*[.:-])/g, '\n\n$1')
    .replace(/\s+(Parágrafo\b)/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splits an institutional document (Pacto de Convivencia or SIEE) by "Artículo X."
 * and also captures introductory/glossary sections before Article 1.
 */
export function chunkInstitutionalText(
  structuredText: string,
  sourceName: string
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  // Match "Artículo <number>." at start of line
  const articleRegex = /(?:^|\n)(Artículo\s+(\d+)\s*[.:-]\s*[^\n]{1,120})/g;
  const matches: Array<{ index: number; header: string; articleNum: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = articleRegex.exec(structuredText)) !== null) {
    const headerSnippet = match[1].trim();
    // Extract a clean short title (up to first period after "Artículo X.")
    const shortHeaderMatch = headerSnippet.match(/^(Artículo\s+\d+\s*[.:-]\s*[^.]{3,95}\.?)/);
    const cleanHeader = shortHeaderMatch ? shortHeaderMatch[1].trim() : headerSnippet.slice(0, 90);

    matches.push({
      index: match.index + ( structuredText[match.index] === '\n' ? 1 : 0 ),
      header: cleanHeader,
      articleNum: parseInt(match[2], 10),
    });
  }

  // 1. Capture preamble / glossary before Article 1
  const firstArticleIdx = matches.length > 0 ? matches[0].index : structuredText.length;
  const preamble = structuredText.slice(0, firstArticleIdx).trim();
  if (preamble.length > 100) {
    const preambleBlocks = splitByMaxChars(preamble, 1500, 200);
    preambleBlocks.forEach((block, idx) => {
      chunks.push({
        id: `${slugify(sourceName)}-preambulo-${idx + 1}`,
        source: sourceName,
        section: `${sourceName} - Introducción y Glosario (Parte ${idx + 1}/${preambleBlocks.length})`,
        content: `[Fuente: ${sourceName} | Sección: Introducción y Glosario - Parte ${idx + 1}]\n${block}`,
        metadata: {
          type: 'pdf',
        },
      });
    });
  }

  // 2. Capture each Article
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextIdx = i + 1 < matches.length ? matches[i + 1].index : structuredText.length;
    const rawArticleText = structuredText.slice(current.index, nextIdx).trim();

    const subParts = splitByMaxChars(rawArticleText, 1800, 200);
    subParts.forEach((part, subIdx) => {
      const partLabel = subParts.length > 1 ? ` (Parte ${subIdx + 1}/${subParts.length})` : '';
      const sectionTitle = `${current.header}${partLabel}`;
      chunks.push({
        id: `${slugify(sourceName)}-art-${current.articleNum}-${subIdx + 1}-${i}`,
        source: sourceName,
        section: sectionTitle,
        content: `[Fuente: ${sourceName} | ${sectionTitle}]\n${part}`,
        metadata: {
          type: 'pdf',
          articleNumber: current.articleNum,
        },
      });
    });
  }

  return chunks;
}

/**
 * Extracts text per page from a PDF file using unpdf and chunks it by Article.
 */
export async function extractAndChunkPdf(pdfPath: string, sourceLabel: string): Promise<KnowledgeChunk[]> {
  const buffer = await fs.readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  const structured = normalizePdfStructure(pages);
  return chunkInstitutionalText(structured, sourceLabel);
}

/**
 * Chunks a Markdown file by H2 (`## `) sections.
 */
export async function chunkMarkdownFile(mdPath: string, sourceLabel: string): Promise<KnowledgeChunk[]> {
  const raw = await fs.readFile(mdPath, 'utf-8');
  const sections = raw.split(/\n(?=##\s+)/g);
  const chunks: KnowledgeChunk[] = [];

  sections.forEach((sec, idx) => {
    const trimmed = sec.trim();
    if (!trimmed) return;
    const firstLine = trimmed.split('\n')[0].replace(/^#+\s*/, '').trim();
    chunks.push({
      id: `${slugify(sourceLabel)}-md-${idx + 1}`,
      source: sourceLabel,
      section: firstLine || `Sección ${idx + 1}`,
      content: `[Fuente: ${sourceLabel} | ${firstLine}]\n${trimmed}`,
      metadata: {
        type: 'markdown',
      },
    });
  });

  return chunks;
}

/**
 * Parses a CSV file (or Google Sheets CSV export) into readable semantic rows.
 */
export function parseCsvToChunks(csvContent: string, sourceLabel: string): KnowledgeChunk[] {
  const lines = csvContent
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  const chunks: KnowledgeChunk[] = [];

  const formattedRows = rows.map((row) => {
    return headers
      .map((h, i) => `• **${h.replace(/_/g, ' ')}:** ${row[i] || 'N/A'}`)
      .join('\n');
  });

  const groupSize = 4;
  for (let i = 0; i < formattedRows.length; i += groupSize) {
    const slice = formattedRows.slice(i, i + groupSize);
    const rawSliceRows = rows.slice(i, i + groupSize);
    const titleHint = rawSliceRows.map((r) => r[0] + (r[1] ? ` (${r[1]})` : '')).join(', ');

    chunks.push({
      id: `${slugify(sourceLabel)}-row-${Math.floor(i / groupSize) + 1}`,
      source: sourceLabel,
      section: `${sourceLabel}: ${titleHint}`,
      content: `[Fuente: Hoja de Cálculo ${sourceLabel} | Registros: ${titleHint}]\n\n${slice.join('\n\n---\n\n')}`,
      metadata: {
        type: 'csv',
      },
    });
  }

  return chunks;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function splitByMaxChars(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];

  // Split by sentences or newlines if single paragraph is huge
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const parts: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + ' ' + s).length > maxChars && current.length > 0) {
      parts.push(current.trim());
      const tail = current.slice(-overlap);
      current = tail + ' ' + s;
    } else {
      current = current ? current + ' ' + s : s;
    }
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
