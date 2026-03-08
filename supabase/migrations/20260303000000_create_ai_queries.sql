-- ─────────────────────────────────────────────────────────
-- Migration: AI Queries table for analytics & caching
-- Tracks all AI-driven graph queries for rate limiting,
-- analytics, and response caching.
-- ─────────────────────────────────────────────────────────

-- Create ai_query_type enum
CREATE TYPE ai_query_type AS ENUM (
  'graph_query',      -- Free-form codebase question
  'overview',         -- Project overview
  'error_analysis',   -- Error-focused subgraph
  'trace_analysis',   -- Trace-focused subgraph
  'dependency',       -- Dependency analysis
  'explain_error'     -- Single error explanation (existing flow)
);

-- Create the ai_queries table
CREATE TABLE IF NOT EXISTS ai_queries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Query details
  query_type    ai_query_type NOT NULL,
  query_text    TEXT,                     -- The user's natural language query

  -- Results cache
  result_nodes  INTEGER DEFAULT 0,        -- Number of nodes returned
  result_edges  INTEGER DEFAULT 0,        -- Number of edges returned

  -- LLM usage tracking
  provider      TEXT,                     -- 'openai' | 'anthropic'
  model         TEXT,                     -- e.g. 'gpt-4o-mini'
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  key_source    TEXT DEFAULT 'platform',  -- 'byok' | 'platform'

  -- Context
  context_node_ids UUID[] DEFAULT '{}',   -- Seed node IDs used
  session_id    UUID REFERENCES ai_sessions(id) ON DELETE SET NULL,

  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms   INTEGER                   -- Total query processing time
);

-- Indexes for analytics queries
CREATE INDEX idx_ai_queries_project_id ON ai_queries(project_id);
CREATE INDEX idx_ai_queries_user_id ON ai_queries(user_id);
CREATE INDEX idx_ai_queries_created_at ON ai_queries(created_at DESC);
CREATE INDEX idx_ai_queries_type ON ai_queries(query_type);

-- RLS policies
ALTER TABLE ai_queries ENABLE ROW LEVEL SECURITY;

-- Users can read their own queries
CREATE POLICY "Users can view own queries"
  ON ai_queries FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own queries
CREATE POLICY "Users can insert own queries"
  ON ai_queries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do anything (for backend analytics)
CREATE POLICY "Service role full access"
  ON ai_queries FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────
-- Add embedding column to code_nodes if not exists
-- (ensures pgvector is available for semantic search)
-- ─────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Check if embedding column already exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'code_nodes' AND column_name = 'embedding'
  ) THEN
    -- Ensure pgvector extension is available
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE code_nodes ADD COLUMN embedding vector(1536);
    CREATE INDEX idx_code_nodes_embedding ON code_nodes
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  END IF;
END
$$;
