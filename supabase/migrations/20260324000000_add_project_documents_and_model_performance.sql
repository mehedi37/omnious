-- Project documents: stores README, docs, and other project knowledge for RAG
CREATE TABLE IF NOT EXISTS project_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_path    text NOT NULL,
  doc_type    text NOT NULL DEFAULT 'markdown',
  content     text NOT NULL,
  content_hash text NOT NULL,
  embedding   vector(768),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE(project_id, doc_path)
);

COMMENT ON TABLE project_documents IS 'Indexed project documentation (README, docs/) for RAG context injection.';

-- Index for fast lookup by project
CREATE INDEX idx_project_documents_project ON project_documents(project_id);

-- Vector similarity index for RAG
CREATE INDEX idx_project_documents_embedding ON project_documents
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

-- RLS
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_documents_select" ON project_documents
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_documents_insert" ON project_documents
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_documents_update" ON project_documents
  FOR UPDATE USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_documents_delete" ON project_documents
  FOR DELETE USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.user_id = auth.uid()
    )
  );

-- Model performance tracking: per-task success/failure rates
CREATE TABLE IF NOT EXISTS model_performance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type     text NOT NULL,
  model_name    text NOT NULL,
  provider      text NOT NULL,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  avg_latency_ms numeric NOT NULL DEFAULT 0,
  last_used     timestamptz NOT NULL DEFAULT now(),

  UNIQUE(task_type, model_name, provider)
);

COMMENT ON TABLE model_performance IS 'Tracks LLM model success/failure rates per task type for adaptive model selection.';

CREATE INDEX idx_model_performance_task ON model_performance(task_type);

-- RLS: only service role should write; authenticated can read
ALTER TABLE model_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "model_performance_select" ON model_performance
  FOR SELECT USING (true);

-- Updated_at trigger for project_documents
CREATE OR REPLACE FUNCTION update_project_documents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_project_documents_updated_at
  BEFORE UPDATE ON project_documents
  FOR EACH ROW EXECUTE FUNCTION update_project_documents_updated_at();
