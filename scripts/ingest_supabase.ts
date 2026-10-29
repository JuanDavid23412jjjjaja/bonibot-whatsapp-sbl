import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../src/config/env.js';
import { KnowledgeChunk } from '../src/rag/chunker.js';
import { generateEmbedding } from '../src/llm/embeddings.js';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const kbPath = path.resolve(process.cwd(), 'data', 'knowledge_base.json');
  const raw = await fs.readFile(kbPath, 'utf-8');
  const chunks = JSON.parse(raw) as KnowledgeChunk[];

  if (!env.gemini.apiKey) {
    console.error('❌ Se requiere GEMINI_API_KEY en el archivo .env para generar los embeddings gratuitos (text-embedding-004).');
    process.exit(1);
  }

  console.log(`🧠 Generando embeddings (768 dimensiones) con Gemini para ${chunks.length} fragmentos...`);

  const supabase = isSupabaseConfigured()
    ? createClient(env.supabase.url, env.supabase.serviceRoleKey)
    : null;

  let embeddedCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.embedding || chunk.embedding.length === 0) {
      const emb = await generateEmbedding(`${chunk.section}\n${chunk.content}`);
      if (emb) {
        chunk.embedding = emb;
        embeddedCount++;
      }
      // Pequeña pausa para respetar límite gratuito de AI Studio
      await sleep(80);
    }

    if (supabase && chunk.embedding) {
      const { error } = await supabase.from('sbl_knowledge_chunks').upsert({
        id: chunk.id,
        source: chunk.source,
        section: chunk.section,
        content: chunk.content,
        metadata: chunk.metadata,
        embedding: chunk.embedding,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.warn(`⚠️ Error subiendo ${chunk.id} a Supabase:`, error.message);
      }
    }

    if ((i + 1) % 25 === 0 || i + 1 === chunks.length) {
      console.log(`   Progreso: ${i + 1}/${chunks.length} fragmentos procesados...`);
    }
  }

  // Guardar también los vectores en data/knowledge_base.json para búsqueda vectorial local
  await fs.writeFile(kbPath, JSON.stringify(chunks, null, 2), 'utf-8');
  console.log(`✅ Finalizado. Nuevos embeddings generados: ${embeddedCount}.`);
  if (supabase) {
    console.log(`☁️ Sincronizado con la tabla sbl_knowledge_chunks en Supabase.`);
  } else {
    console.log(`💾 Vectores guardados localmente en data/knowledge_base.json (Supabase no configurado aún).`);
  }
}

main().catch((err) => {
  console.error('Error en ingesta:', err);
  process.exit(1);
});
