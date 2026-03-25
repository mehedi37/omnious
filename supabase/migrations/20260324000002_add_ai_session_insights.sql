-- AI session insights: extracted knowledge from AI conversations for memory injection
CREATE TABLE IF NOT EXISTS ai_session_insights (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight      text NOT NULL,
  category     text NOT NULL DEFAULT 'general',
  embedding    vector(768),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT insight_min_length CHECK (char_length(insight) >= 10)
);

COMMENT ON TABLE ai_session_insights IS 'Key insights extracted from AI conversations, used for memory injection in future prompts.';

CREATE INDEX idx_ai_session_insights_project ON ai_session_insights(project_id);
CREATE INDEX idx_ai_session_insights_user ON ai_session_insights(user_id, project_id);

-- Vector similarity index for finding relevant insights
CREATE INDEX idx_ai_session_insights_embedding ON ai_session_insights
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

-- RLS
ALTER TABLE ai_session_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_session_insights_select" ON ai_session_insights
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "ai_session_insights_insert" ON ai_session_insights
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_session_insights_delete" ON ai_session_insights
  FOR DELETE USING (user_id = auth.uid());

-- RPC to find relevant insights by embedding similarity
CREATE OR REPLACE FUNCTION match_session_insights(
  p_project_id uuid,
  p_user_id uuid,
  query_embedding text,
  similarity_threshold float DEFAULT 0.65,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  insight text,
  category text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_embedding vector(768);
BEGIN
  v_embedding := query_embedding::vector(768);

  RETURN QUERY
  SELECT
    si.id,
    si.insight,
    si.category,
    1 - (si.embedding <=> v_embedding) AS similarity
  FROM ai_session_insights si
  WHERE si.project_id = p_project_id
    AND si.user_id = p_user_id
    AND si.embedding IS NOT NULL
    AND 1 - (si.embedding <=> v_embedding) >= similarity_threshold
  ORDER BY si.embedding <=> v_embedding
  LIMIT match_count;
END;
$$;
