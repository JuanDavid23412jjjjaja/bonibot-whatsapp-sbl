import fs from 'fs/promises';
import path from 'path';
import {
  chunkMarkdownFile,
  extractAndChunkPdf,
  KnowledgeChunk,
  parseCsvToChunks,
} from '../src/rag/chunker.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('🦊 [BoniBot SBL] Construyendo Base de Conocimiento Institucional...\n');
  const rootDir = process.cwd();
  const allChunks: KnowledgeChunk[] = [];

  // 1. Procesar PDFs grandes (Pacto de Convivencia 2026 y SIEE V01)
  const pdfSources = [
    { file: 'PACTO DE CONVIVENCIA 2026.pdf', label: 'Pacto de Convivencia 2026' },
    { file: 'SIEE (V01).pdf', label: 'SIEE V(01) - Sistema Institucional de Evaluación' },
  ];

  for (const pdf of pdfSources) {
    const fullPath = path.resolve(rootDir, pdf.file);
    try {
      await fs.access(fullPath);
      console.log(`📕 Extrayendo y fragmentando por artículos: ${pdf.file}...`);
      const chunks = await extractAndChunkPdf(fullPath, pdf.label);
      console.log(`   ✅ ${chunks.length} fragmentos extraídos de ${pdf.label}`);
      allChunks.push(...chunks);
    } catch (err) {
      console.warn(`   ⚠️ No se pudo procesar ${pdf.file}:`, err);
    }
  }

  // 2. Procesar Archivos Markdown Curados (Póliza Escolar y Boletín Carlo Acutis)
  const mdDir = path.resolve(rootDir, 'data', 'markdown');
  try {
    const mdFiles = (await fs.readdir(mdDir)).filter((f) => f.endsWith('.md'));
    for (const file of mdFiles) {
      const fullPath = path.join(mdDir, file);
      const label = file.includes('poliza')
        ? 'Póliza Seguro Estudiantil Seguros Mundial (2000694412)'
        : file.includes('boletin')
        ? 'Boletín Proyecto Social Carlo Acutis (Semestre A-2026)'
        : file.replace('.md', '');
      const chunks = await chunkMarkdownFile(fullPath, label);
      console.log(`📄 Markdown procesado (${file}): ${chunks.length} secciones`);
      allChunks.push(...chunks);
    }
  } catch (err) {
    console.warn('⚠️ Carpeta data/markdown no encontrada:', err);
  }

  // 3. Procesar Archivos CSV / Hojas de Cálculo locales
  const sheetsDir = path.resolve(rootDir, 'data', 'sheets');
  try {
    const csvFiles = (await fs.readdir(sheetsDir)).filter((f) => f.endsWith('.csv'));
    for (const file of csvFiles) {
      const fullPath = path.join(sheetsDir, file);
      const rawCsv = await fs.readFile(fullPath, 'utf-8');
      const label = file.includes('directorio')
        ? 'Directorio Docente y Horarios de Atención SBL'
        : file.includes('activate')
        ? 'Horarios Talleres Actívate y Menú Escolar SBL'
        : file.replace('.csv', '');
      const chunks = parseCsvToChunks(rawCsv, label);
      console.log(`📊 Hoja de cálculo procesada (${file}): ${chunks.length} bloques tabulares`);
      allChunks.push(...chunks);
    }
  } catch (err) {
    console.warn('⚠️ Carpeta data/sheets no encontrada:', err);
  }

  // 4. Opcional: Sincronizar desde Google Sheets público en vivo si está configurado
  if (env.googleSheetsCsvUrl) {
    try {
      console.log(`🌐 Descargando Google Sheet en vivo desde URL...`);
      const res = await fetch(env.googleSheetsCsvUrl);
      if (res.ok) {
        const csvText = await res.text();
        const liveChunks = parseCsvToChunks(csvText, 'Google Sheets en Vivo SBL');
        console.log(`   ✅ ${liveChunks.length} bloques importados de Google Sheets`);
        allChunks.push(...liveChunks);
      }
    } catch (err) {
      console.warn('   ⚠️ Error descargando Google Sheet en vivo:', err);
    }
  }

  // 5. Guardar índice local en data/knowledge_base.json
  const outPath = path.resolve(rootDir, 'data', 'knowledge_base.json');
  await fs.writeFile(outPath, JSON.stringify(allChunks, null, 2), 'utf-8');

  console.log(`\n🎉 ¡Base de conocimiento construida con éxito!`);
  console.log(`📦 Total de fragmentos indexados: ${allChunks.length}`);
  console.log(`💾 Guardado en: ${outPath}`);
}

main().catch((err) => {
  console.error('Error construyendo base de conocimiento:', err);
  process.exit(1);
});
