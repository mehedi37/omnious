-- Migration: Global knowledge base + semantic query cache
-- =========================================================
-- Two-tier knowledge system:
--   1. global_knowledge — curated entries about libraries, patterns, best practices
--      that are shared across all projects. Enables RAG with "global intelligence".
--   2. knowledge_cache  — semantic response cache keyed by query embedding.
--      Paraphrased queries with cosine >= 0.92 get a cache hit, avoiding redundant LLM calls.

-- ─── 1. Global Knowledge Table ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.global_knowledge (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What this entry covers
  category     text NOT NULL CHECK (category IN (
    'library', 'pattern', 'best_practice', 'syntax', 'framework', 'tool'
  )),
  title        text NOT NULL,
  content      text NOT NULL,

  -- Semantic search
  embedding    extensions.vector(1536),

  -- Metadata
  source_url   text,                      -- e.g. npm page, docs link
  tags         text[] NOT NULL DEFAULT '{}',
  version      text,                      -- e.g. "react@19", "express@5"

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (category, title)
);

-- Vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_global_knowledge_embedding
  ON public.global_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Text search
CREATE INDEX IF NOT EXISTS idx_global_knowledge_tags
  ON public.global_knowledge USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_global_knowledge_category
  ON public.global_knowledge(category);

-- RLS: read-only for authenticated users, full access for service role
ALTER TABLE public.global_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read global knowledge"
  ON public.global_knowledge FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "Service role manages global knowledge"
  ON public.global_knowledge FOR ALL
  USING (auth.role() = 'service_role');

-- Match function for RAG retrieval
CREATE OR REPLACE FUNCTION public.match_global_knowledge(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5,
  filter_category text DEFAULT NULL
)
RETURNS TABLE(
  id         uuid,
  category   text,
  title      text,
  content    text,
  tags       text[],
  similarity double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    gk.id,
    gk.category,
    gk.title,
    gk.content,
    gk.tags,
    (1 - (gk.embedding <=> query_embedding)) AS similarity
  FROM public.global_knowledge gk
  WHERE gk.embedding IS NOT NULL
    AND (1 - (gk.embedding <=> query_embedding)) > match_threshold
    AND (filter_category IS NULL OR gk.category = filter_category)
  ORDER BY gk.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ─── 2. Semantic Knowledge Cache ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.knowledge_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Cache key: the query and its embedding
  query_text      text NOT NULL,
  query_embedding extensions.vector(1536),

  -- Cache value: the LLM response
  response_text   text NOT NULL,
  response_model  text NOT NULL,

  -- Context fingerprint: invalidate if underlying data changed
  context_hash    text NOT NULL,   -- hash of node oir_ids used in answer

  -- Stats
  hit_count       integer NOT NULL DEFAULT 0,
  last_hit_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- Vector index for cosine similarity lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_cache_embedding
  ON public.knowledge_cache
  USING ivfflat (query_embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_knowledge_cache_project
  ON public.knowledge_cache(project_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_cache_expires
  ON public.knowledge_cache(expires_at);

-- RLS
ALTER TABLE public.knowledge_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on knowledge_cache"
  ON public.knowledge_cache FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Project members can read cache"
  ON public.knowledge_cache FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.workspace_members wm
        ON wm.workspace_id = p.workspace_id
        AND wm.user_id = auth.uid()
      WHERE p.id = knowledge_cache.project_id
    )
  );

-- Match function: find semantically similar cached responses
CREATE OR REPLACE FUNCTION public.match_knowledge_cache(
  p_project_id uuid,
  query_embedding extensions.vector,
  similarity_threshold double precision DEFAULT 0.92
)
RETURNS TABLE(
  id             uuid,
  query_text     text,
  response_text  text,
  response_model text,
  context_hash   text,
  similarity     double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kc.id,
    kc.query_text,
    kc.response_text,
    kc.response_model,
    kc.context_hash,
    (1 - (kc.query_embedding <=> query_embedding)) AS similarity
  FROM public.knowledge_cache kc
  WHERE kc.project_id = p_project_id
    AND kc.query_embedding IS NOT NULL
    AND kc.expires_at > now()
    AND (1 - (kc.query_embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY kc.query_embedding <=> query_embedding ASC
  LIMIT 1;
$$;

-- Cleanup function: remove expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_knowledge_cache()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.knowledge_cache
  WHERE expires_at < now();
$$;
