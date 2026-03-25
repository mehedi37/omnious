-- Migration: Resize all embedding vector columns from 1536 → 768
-- Reason: The default Ollama embedding models (nomic-embed-text, nomic-embed-text-v2-moe)
--         produce 768-dimensional vectors. The original 1536 was an OpenAI assumption.

-- ── code_nodes.embedding ──────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_code_nodes_embedding;

ALTER TABLE public.code_nodes
  ALTER COLUMN embedding TYPE extensions.vector(768);

CREATE INDEX idx_code_nodes_embedding
  ON public.code_nodes
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── global_knowledge.embedding ───────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_global_knowledge_embedding;

ALTER TABLE public.global_knowledge
  ALTER COLUMN embedding TYPE extensions.vector(768);

CREATE INDEX idx_global_knowledge_embedding
  ON public.global_knowledge
  USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 50);

-- ── knowledge_cache.query_embedding ─────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_knowledge_cache_embedding;

ALTER TABLE public.knowledge_cache
  ALTER COLUMN query_embedding TYPE extensions.vector(768);

CREATE INDEX idx_knowledge_cache_embedding
  ON public.knowledge_cache
  USING ivfflat (query_embedding extensions.vector_cosine_ops)
  WITH (lists = 50);
