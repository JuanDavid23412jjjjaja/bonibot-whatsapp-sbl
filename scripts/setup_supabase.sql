-- =============================================================================
-- SCRIPT SQL PARA SUPABASE (BoniBot - Colegio San Bonifacio de las Lanzas SBL)
-- Copia y pega este script en el "SQL Editor" de tu proyecto gratuito en Supabase
-- =============================================================================

-- 1. Activar extensión vectorial pgvector
create extension if not exists vector;

-- 2. Tabla de fragmentos de conocimiento institucional (RAG Híbrido)
create table if not exists public.sbl_knowledge_chunks (
  id text primary key,
  source text not null,
  section text not null,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(768),
  fts tsvector generated always as (to_tsvector('spanish', coalesce(section, '') || ' ' || coalesce(content, ''))) stored,
  updated_at timestamptz default now()
);

-- Índices para búsqueda rápida (Vectorial + Full-Text Search en Español)
create index if not exists idx_sbl_chunks_fts on public.sbl_knowledge_chunks using gin (fts);

-- 3. Tabla de memoria conversacional por número de WhatsApp
create table if not exists public.chat_memory (
  id bigserial primary key,
  phone_number text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists idx_chat_memory_phone on public.chat_memory (phone_number, created_at desc);

-- 4. Función RPC de Búsqueda Híbrida (Similitud Semántica + Palabras Clave)
create or replace function public.match_sbl_documents (
  query_embedding vector(768),
  query_text text,
  match_count int default 6
)
returns table (
  id text,
  source text,
  section text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.source,
    c.section,
    c.content,
    c.metadata,
    (
      -- 75% peso semántico (pgvector) + 25% peso léxico (Full-Text Search en español)
      0.75 * (1 - (c.embedding <=> query_embedding)) +
      0.25 * coalesce(ts_rank(c.fts, websearch_to_tsquery('spanish', query_text)), 0)
    ) as similarity
  from public.sbl_knowledge_chunks c
  where c.embedding is not null
  order by similarity desc
  limit match_count;
$$;
