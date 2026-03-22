-- Migration: Multi-signal ranking for code node search
-- =======================================================
-- Replaces simple cosine + trigram scoring with a 5-signal weighted ranking:
--   1. Semantic similarity (pgvector cosine)      — w_semantic  (default 0.50)
--   2. Trigram name match  (pg_trgm)              — w_trigram   (default 0.15)
--   3. Graph centrality    (in-degree + out-degree)— w_centrality(default 0.15)
--   4. Error frequency     (error_snapshots)       — w_error     (default 0.15)
--   5. Recency             (updated_at freshness)  — w_recency   (default 0.05)

CREATE OR REPLACE FUNCTION public.match_code_nodes_ranked(
  p_project_id   uuid,
  query_embedding extensions.vector,
  query_text     text             DEFAULT '',
  match_threshold double precision DEFAULT 0.55,
  match_count    integer          DEFAULT 20,
  -- Tunable weights (must sum to 1.0 on caller side for proper [0,1] scores)
  w_semantic     double precision DEFAULT 0.50,
  w_trigram      double precision DEFAULT 0.15,
  w_centrality   double precision DEFAULT 0.15,
  w_error        double precision DEFAULT 0.15,
  w_recency      double precision DEFAULT 0.05
)
RETURNS TABLE(
  id              uuid,
  oir_id          text,
  type            public.oir_node_type,
  name            text,
  file_path       text,
  line_start      integer,
  line_end        integer,
  signature       text,
  doc_comment     text,
  metadata        jsonb,
  code_body       text,
  similarity      double precision,
  trigram_score    double precision,
  centrality      double precision,
  error_signal    double precision,
  recency_score   double precision,
  ranked_score    double precision
)
LANGUAGE sql STABLE
AS $$
  WITH
  -- Pre-compute max degree and max errors for normalization within this project
  edge_degrees AS (
    SELECT node_id, count(*)::double precision AS degree
    FROM (
      SELECT source_node_id AS node_id FROM public.code_edges WHERE project_id = p_project_id
      UNION ALL
      SELECT target_node_id AS node_id FROM public.code_edges WHERE project_id = p_project_id
    ) e
    GROUP BY node_id
  ),
  max_degree AS (
    SELECT coalesce(max(degree), 1.0) AS val FROM edge_degrees
  ),
  error_counts AS (
    SELECT code_node_id, sum(occurrence_count)::double precision AS total_errors
    FROM public.error_snapshots
    WHERE project_id = p_project_id
      AND resolved_at IS NULL
      AND code_node_id IS NOT NULL
    GROUP BY code_node_id
  ),
  max_errors AS (
    SELECT coalesce(max(total_errors), 1.0) AS val FROM error_counts
  ),
  -- Candidate pool: semantic matches above threshold
  candidates AS (
    SELECT
      cn.id,
      cn.oir_id,
      cn.type,
      cn.name,
      cn.file_path,
      cn.line_start,
      cn.line_end,
      cn.signature,
      cn.doc_comment,
      cn.metadata,
      cn.code_body,
      cn.updated_at,
      (1 - (cn.embedding <=> query_embedding)) AS raw_similarity
    FROM public.code_nodes cn
    WHERE cn.project_id = p_project_id
      AND cn.embedding IS NOT NULL
      AND (1 - (cn.embedding <=> query_embedding)) > match_threshold
    ORDER BY cn.embedding <=> query_embedding ASC
    LIMIT match_count * 3  -- over-fetch to allow reranking
  ),
  -- Add trigram-only matches not already captured by vector search
  trigram_only AS (
    SELECT
      cn.id,
      cn.oir_id,
      cn.type,
      cn.name,
      cn.file_path,
      cn.line_start,
      cn.line_end,
      cn.signature,
      cn.doc_comment,
      cn.metadata,
      cn.code_body,
      cn.updated_at,
      0.0::double precision AS raw_similarity
    FROM public.code_nodes cn
    WHERE cn.project_id = p_project_id
      AND length(query_text) > 2
      AND public.similarity(cn.name, query_text) > 0.3
      AND cn.id NOT IN (SELECT c.id FROM candidates c)
    ORDER BY public.similarity(cn.name, query_text) DESC
    LIMIT match_count
  ),
  -- Merge candidate pools
  all_candidates AS (
    SELECT * FROM candidates
    UNION ALL
    SELECT * FROM trigram_only
  ),
  -- Compute all signals per candidate
  scored AS (
    SELECT
      ac.id,
      ac.oir_id,
      ac.type,
      ac.name,
      ac.file_path,
      ac.line_start,
      ac.line_end,
      ac.signature,
      ac.doc_comment,
      ac.metadata,
      ac.code_body,
      -- Signal 1: Semantic similarity [0..1]
      ac.raw_similarity AS similarity,
      -- Signal 2: Trigram name match [0..1]
      CASE
        WHEN length(query_text) > 2 THEN public.similarity(ac.name, query_text)
        ELSE 0.0
      END AS trigram_score,
      -- Signal 3: Graph centrality — normalized degree [0..1]
      coalesce(ed.degree, 0.0) / md.val AS centrality,
      -- Signal 4: Error frequency — normalized error count [0..1]
      coalesce(ec.total_errors, 0.0) / me.val AS error_signal,
      -- Signal 5: Recency — exponential decay with 30-day half-life [0..1]
      exp(-0.693 * extract(EPOCH FROM (now() - ac.updated_at)) / (30.0 * 86400.0)) AS recency_score
    FROM all_candidates ac
    CROSS JOIN max_degree md
    CROSS JOIN max_errors me
    LEFT JOIN edge_degrees ed ON ed.node_id = ac.id
    LEFT JOIN error_counts ec ON ec.code_node_id = ac.id
  ),
  -- Deduplicate (union may have overlaps)
  deduped AS (
    SELECT DISTINCT ON (scored.id)
      scored.*
    FROM scored
    ORDER BY scored.id, scored.similarity DESC
  )
  SELECT
    d.id,
    d.oir_id,
    d.type,
    d.name,
    d.file_path,
    d.line_start,
    d.line_end,
    d.signature,
    d.doc_comment,
    d.metadata,
    d.code_body,
    d.similarity,
    d.trigram_score,
    d.centrality,
    d.error_signal,
    d.recency_score,
    -- Weighted combination
    (w_semantic   * d.similarity
   + w_trigram    * d.trigram_score
   + w_centrality * d.centrality
   + w_error      * d.error_signal
   + w_recency    * d.recency_score) AS ranked_score
  FROM deduped d
  ORDER BY
    (w_semantic   * d.similarity
   + w_trigram    * d.trigram_score
   + w_centrality * d.centrality
   + w_error      * d.error_signal
   + w_recency    * d.recency_score) DESC
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_code_nodes_ranked IS
  'Multi-signal ranked search: combines semantic similarity, trigram matching, graph centrality, error frequency, and recency into a single weighted score.';

GRANT EXECUTE ON FUNCTION public.match_code_nodes_ranked TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_code_nodes_ranked TO service_role;
GRANT EXECUTE ON FUNCTION public.match_code_nodes_ranked TO anon;
