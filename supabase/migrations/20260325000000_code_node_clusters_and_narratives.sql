-- Migration: Persistent code_node_clusters table + narrative column on saved_views
-- ================================================================
-- Phase 2.2: Store community detection results for fast retrieval.
-- Phase 2.3: Add narrative field to saved_views for AI-generated graph stories.

-- ─── code_node_clusters table ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.code_node_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cluster_label text NOT NULL,
  cluster_color text NOT NULL,
  layer text,  -- architectural layer: 'controller', 'service', 'repository', 'model', 'util', 'config', null
  node_ids uuid[] NOT NULL DEFAULT '{}',
  node_count integer NOT NULL DEFAULT 0,
  representative_dir text,  -- most common directory prefix
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.code_node_clusters OWNER TO postgres;

COMMENT ON TABLE public.code_node_clusters IS
  'Persisted community detection clusters. Recomputed on each CLI push.';

CREATE INDEX idx_code_node_clusters_project ON public.code_node_clusters USING btree (project_id);

-- RLS policies
ALTER TABLE public.code_node_clusters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view clusters for accessible projects"
  ON public.code_node_clusters FOR SELECT TO authenticated
  USING (private.has_project_access(project_id));

CREATE POLICY "Service role can manage clusters"
  ON public.code_node_clusters FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER handle_code_node_clusters_updated_at
  BEFORE UPDATE ON public.code_node_clusters
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- ─── Add narrative column to saved_views ────────────────────────────

ALTER TABLE public.saved_views
  ADD COLUMN IF NOT EXISTS narrative jsonb;

COMMENT ON COLUMN public.saved_views.narrative IS
  'AI-generated narrative for graph slices: { summary, pattern, dataFlow, followUpQuestions }';

-- ─── Fix detect_communities: declare `changed` variable ─────────────

CREATE OR REPLACE FUNCTION public.detect_communities(
  p_project_id uuid,
  p_max_iterations integer DEFAULT 10
)
RETURNS TABLE(
  node_id    uuid,
  node_name  text,
  node_type  public.oir_node_type,
  file_path  text,
  community  uuid
)
LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  iteration integer := 0;
  changed boolean := false;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _lp_labels (
    nid uuid PRIMARY KEY,
    label uuid NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _lp_labels;

  INSERT INTO _lp_labels (nid, label)
  SELECT cn.id, cn.id
  FROM public.code_nodes cn
  WHERE cn.project_id = p_project_id;

  LOOP
    EXIT WHEN iteration >= p_max_iterations;
    iteration := iteration + 1;

    WITH neighbor_labels AS (
      SELECT
        lp.nid,
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

    IF NOT FOUND THEN
      EXIT;
    END IF;
  END LOOP;

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

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_node_clusters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.code_node_clusters TO service_role;
