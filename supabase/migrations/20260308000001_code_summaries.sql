-- Migration: Hierarchical code summaries table
-- ==================================================================
-- Directory-level and file-level natural language summaries generated
-- by a fast LLM after push. Used for broad queries ("how does auth
-- work?") and as tooltips on the AST tree sidebar.

CREATE TABLE IF NOT EXISTS public.code_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- What this summary covers
  scope       text NOT NULL CHECK (scope IN ('directory', 'file')),
  path        text NOT NULL,  -- e.g. "src/auth/" or "src/auth/login.ts"

  -- The summary itself
  summary     text NOT NULL,
  node_count  integer NOT NULL DEFAULT 0,  -- how many nodes contributed

  -- Cache invalidation
  content_hash text NOT NULL,  -- hash of contributing node content_hashes
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (project_id, scope, path)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_code_summaries_project
  ON public.code_summaries(project_id);
CREATE INDEX IF NOT EXISTS idx_code_summaries_path
  ON public.code_summaries USING gin (path public.gin_trgm_ops);

-- RLS
ALTER TABLE public.code_summaries ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on code_summaries"
  ON public.code_summaries FOR ALL
  USING (auth.role() = 'service_role');

-- Project members can read summaries
CREATE POLICY "Project members can read summaries"
  ON public.code_summaries FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      JOIN public.workspace_members wm
        ON wm.workspace_id = p.workspace_id
        AND wm.user_id = auth.uid()
      WHERE p.id = code_summaries.project_id
    )
  );

-- Auto-update updated_at
CREATE TRIGGER handle_code_summaries_updated_at
  BEFORE UPDATE ON public.code_summaries
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);
