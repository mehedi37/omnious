-- Migration: Algorithmic community detection via label propagation
-- ================================================================
-- Runs label propagation on the code_edges graph to detect communities.
-- Returns each node with its assigned community label.
-- This is deterministic & LLM-free — suitable for auto-clustering after every push.

CREATE OR REPLACE FUNCTION public.detect_communities(
  p_project_id uuid,
  p_max_iterations integer DEFAULT 10
)
RETURNS TABLE(
  node_id    uuid,
  node_name  text,
  node_type  public.oir_node_type,
  file_path  text,
  community  uuid  -- ID of the "leader" node representing this community
)
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  iteration integer := 0;
BEGIN
  -- Initialize: each node is its own community
  CREATE TEMP TABLE IF NOT EXISTS _lp_labels (
    nid uuid PRIMARY KEY,
    label uuid NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _lp_labels;

  INSERT INTO _lp_labels (nid, label)
  SELECT cn.id, cn.id
  FROM public.code_nodes cn
  WHERE cn.project_id = p_project_id;

  -- Label propagation: each node adopts the most frequent label among its neighbors
  LOOP
    EXIT WHEN iteration >= p_max_iterations;
    iteration := iteration + 1;
    changed := false;

    -- For each node, find the most common label among its neighbors
    WITH neighbor_labels AS (
      SELECT
        lp.nid,
        -- Get labels of all neighbors (both directions)
        coalesce(nl.label, lp.label) AS neighbor_label
      FROM _lp_labels lp
      LEFT JOIN LATERAL (
        SELECT target_node_id AS neighbor_id
        FROM public.code_edges
        WHERE project_id = p_project_id AND source_node_id = lp.nid
        UNION ALL
        SELECT source_node_id AS neighbor_id
        FROM public.code_edges
        WHERE project_id = p_project_id AND target_node_id = lp.nid
      ) neighbors ON true
      LEFT JOIN _lp_labels nl ON nl.nid = neighbors.neighbor_id
    ),
    -- Count label frequencies per node and pick the most common
    label_counts AS (
      SELECT
        nid,
        neighbor_label,
        count(*) AS cnt,
        ROW_NUMBER() OVER (PARTITION BY nid ORDER BY count(*) DESC, neighbor_label) AS rn
      FROM neighbor_labels
      WHERE neighbor_label IS NOT NULL
      GROUP BY nid, neighbor_label
    ),
    best_labels AS (
      SELECT nid, neighbor_label AS new_label
      FROM label_counts
      WHERE rn = 1
    )
    UPDATE _lp_labels lp
    SET label = bl.new_label
    FROM best_labels bl
    WHERE lp.nid = bl.nid
      AND lp.label IS DISTINCT FROM bl.new_label;

    -- Check if any labels changed (FOUND is set by the UPDATE above)
    IF NOT FOUND THEN
      EXIT;
    END IF;
  END LOOP;

  -- Return results joined with node metadata
  RETURN QUERY
  SELECT
    cn.id AS node_id,
    cn.name AS node_name,
    cn.type AS node_type,
    cn.file_path,
    lp.label AS community
  FROM _lp_labels lp
  JOIN public.code_nodes cn ON cn.id = lp.nid
  WHERE cn.project_id = p_project_id
  ORDER BY lp.label, cn.file_path, cn.name;
END;
$$;

COMMENT ON FUNCTION public.detect_communities IS
  'Label propagation community detection on the code graph. Returns each node with its community leader ID. Deterministic, LLM-free.';

GRANT EXECUTE ON FUNCTION public.detect_communities TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_communities TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_communities TO anon;
