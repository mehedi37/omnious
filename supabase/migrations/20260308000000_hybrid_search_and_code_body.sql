-- Migration: Hybrid search (vector + trigram), code_body column, fix traverse_graph
-- ==================================================================================

-- 1. Add code_body column to code_nodes for storing source code
ALTER TABLE public.code_nodes
  ADD COLUMN IF NOT EXISTS code_body text;

COMMENT ON COLUMN public.code_nodes.code_body IS
  'First ~200 lines of source code for the node. Used for LLM context in AI queries.';

-- 2. Add trigram index on code_nodes.name for fast identifier search
CREATE INDEX IF NOT EXISTS idx_code_nodes_name_trgm
  ON public.code_nodes USING gin (name public.gin_trgm_ops);

-- 3. Hybrid search RPC: combines pgvector cosine similarity with pg_trgm trigram matching
--    Returns the union of both result sets, deduped and ranked by combined score.
CREATE OR REPLACE FUNCTION public.match_code_nodes_hybrid(
  p_project_id uuid,
  query_embedding extensions.vector,
  query_text text DEFAULT '',
  match_threshold double precision DEFAULT 0.65,
  match_count integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  oir_id text,
  type public.oir_node_type,
  name text,
  file_path text,
  signature text,
  doc_comment text,
  metadata jsonb,
  similarity double precision,
  trigram_score double precision,
  combined_score double precision
)
LANGUAGE sql STABLE
AS $$
  WITH vector_matches AS (
    SELECT
      cn.id,
      cn.oir_id,
      cn.type,
      cn.name,
      cn.file_path,
      cn.signature,
      cn.doc_comment,
      cn.metadata,
      (1 - (cn.embedding <=> query_embedding)) AS similarity,
      0.0::double precision AS trigram_score
    FROM public.code_nodes cn
    WHERE cn.project_id = p_project_id
      AND cn.embedding IS NOT NULL
      AND (1 - (cn.embedding <=> query_embedding)) > match_threshold
    ORDER BY cn.embedding <=> query_embedding ASC
    LIMIT match_count
  ),
  trigram_matches AS (
    SELECT
      cn.id,
      cn.oir_id,
      cn.type,
      cn.name,
      cn.file_path,
      cn.signature,
      cn.doc_comment,
      cn.metadata,
      0.0::double precision AS similarity,
      public.similarity(cn.name, query_text) AS trigram_score
    FROM public.code_nodes cn
    WHERE cn.project_id = p_project_id
      AND length(query_text) > 2
      AND public.similarity(cn.name, query_text) > 0.3
    ORDER BY public.similarity(cn.name, query_text) DESC
    LIMIT match_count
  ),
  combined AS (
    SELECT * FROM vector_matches
    UNION ALL
    SELECT * FROM trigram_matches
  ),
  deduped AS (
    SELECT DISTINCT ON (combined.id)
      combined.id,
      combined.oir_id,
      combined.type,
      combined.name,
      combined.file_path,
      combined.signature,
      combined.doc_comment,
      combined.metadata,
      max(combined.similarity) OVER (PARTITION BY combined.id) AS similarity,
      max(combined.trigram_score) OVER (PARTITION BY combined.id) AS trigram_score,
      -- Combined score: weighted blend favoring semantic but boosting exact matches
      (0.7 * max(combined.similarity) OVER (PARTITION BY combined.id)
       + 0.3 * max(combined.trigram_score) OVER (PARTITION BY combined.id)) AS combined_score
    FROM combined
    ORDER BY combined.id,
      (0.7 * combined.similarity + 0.3 * combined.trigram_score) DESC
  )
  SELECT * FROM deduped
  ORDER BY deduped.combined_score DESC
  LIMIT least(match_count, 200);
$$;

COMMENT ON FUNCTION public.match_code_nodes_hybrid IS
  'Hybrid search: pgvector cosine similarity + pg_trgm trigram matching for identifier lookups.';

-- Grant access
GRANT EXECUTE ON FUNCTION public.match_code_nodes_hybrid TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_code_nodes_hybrid TO service_role;
GRANT EXECUTE ON FUNCTION public.match_code_nodes_hybrid TO anon;

-- 4. Fix traverse_graph to properly support 'both' direction
CREATE OR REPLACE FUNCTION public.traverse_graph(
  p_node_id uuid,
  p_direction text DEFAULT 'downstream',
  p_max_depth integer DEFAULT 5
)
RETURNS TABLE(
  depth integer,
  node_id uuid,
  node_name text,
  node_type public.oir_node_type,
  edge_type public.oir_edge_type,
  parent_node_id uuid
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $$
  WITH RECURSIVE graph AS (
    SELECT
      0 AS depth,
      cn.id AS node_id,
      cn.name AS node_name,
      cn.type AS node_type,
      null::oir_edge_type AS edge_type,
      null::uuid AS parent_node_id
    FROM code_nodes cn
    WHERE cn.id = p_node_id

    UNION ALL

    SELECT
      g.depth + 1,
      CASE
        WHEN p_direction = 'downstream' THEN ce.target_node_id
        WHEN p_direction = 'upstream' THEN ce.source_node_id
        ELSE -- 'both': follow the edge to the OTHER side
          CASE WHEN ce.source_node_id = g.node_id THEN ce.target_node_id
               ELSE ce.source_node_id END
      END,
      cn2.name,
      cn2.type,
      ce.type,
      g.node_id
    FROM graph g
    JOIN code_edges ce ON (
      CASE
        WHEN p_direction = 'downstream' THEN ce.source_node_id = g.node_id
        WHEN p_direction = 'upstream' THEN ce.target_node_id = g.node_id
        ELSE (ce.source_node_id = g.node_id OR ce.target_node_id = g.node_id)
      END
    )
    JOIN code_nodes cn2 ON cn2.id = (
      CASE
        WHEN p_direction = 'downstream' THEN ce.target_node_id
        WHEN p_direction = 'upstream' THEN ce.source_node_id
        ELSE
          CASE WHEN ce.source_node_id = g.node_id THEN ce.target_node_id
               ELSE ce.source_node_id END
      END
    )
    WHERE g.depth < p_max_depth
  )
  SELECT DISTINCT ON (graph.node_id) graph.* FROM graph;
$$;
