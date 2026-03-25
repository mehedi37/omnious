-- RPC to find project documents by vector similarity (for RAG)
CREATE OR REPLACE FUNCTION match_project_documents(
  p_project_id uuid,
  query_embedding text,
  similarity_threshold float DEFAULT 0.6,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  doc_path text,
  content text,
  doc_type text,
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
    pd.id,
    pd.doc_path,
    pd.content,
    pd.doc_type,
    1 - (pd.embedding <=> v_embedding) AS similarity
  FROM project_documents pd
  WHERE pd.project_id = p_project_id
    AND pd.embedding IS NOT NULL
    AND 1 - (pd.embedding <=> v_embedding) >= similarity_threshold
  ORDER BY pd.embedding <=> v_embedding
  LIMIT match_count;
END;
$$;
