-- Migration: Add severity column + update RPCs for diagnostic severity support
-- =====================================================================

-- 1. Add severity column with sensible default
ALTER TABLE public.error_snapshots
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'error';

COMMENT ON COLUMN public.error_snapshots.severity IS
  'Diagnostic severity: error, warning, or info. Defaults to error for legacy/runtime rows.';

-- 2. Back-fill from metadata.severity for existing CLI static-analysis rows
UPDATE public.error_snapshots
  SET severity = metadata->>'severity'
  WHERE metadata->>'severity' IS NOT NULL
    AND severity = 'error'
    AND source = 'cli-static-analysis';

-- 3. Partial index for fast heatmap/list queries (only unresolved rows)
CREATE INDEX IF NOT EXISTS idx_error_snapshots_severity
  ON public.error_snapshots (project_id, severity)
  WHERE resolved_at IS NULL;

-- 4. Update upsert_error_snapshot with p_severity parameter
CREATE OR REPLACE FUNCTION public.upsert_error_snapshot(
  p_project_id     uuid,
  p_code_node_id   uuid,
  p_trace_id       uuid,
  p_span_id        uuid,
  p_error_type     text,
  p_error_message  text,
  p_error_stack    text,
  p_fingerprint    text,
  p_metadata       jsonb    DEFAULT '{}',
  p_span_otel_id   text     DEFAULT NULL,
  p_source         text     DEFAULT 'runtime',
  p_severity       text     DEFAULT 'error'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.error_snapshots (
    project_id, code_node_id, trace_id, span_id,
    error_type, error_message, error_stack, fingerprint,
    metadata, span_otel_id, source, severity
  ) VALUES (
    p_project_id, p_code_node_id, p_trace_id, p_span_id,
    p_error_type, p_error_message, p_error_stack, p_fingerprint,
    p_metadata, p_span_otel_id, p_source, p_severity
  )
  ON CONFLICT (project_id, fingerprint) DO UPDATE SET
    occurrence_count = public.error_snapshots.occurrence_count + 1,
    last_seen_at     = now(),
    trace_id         = EXCLUDED.trace_id,
    span_id          = EXCLUDED.span_id,
    span_otel_id     = EXCLUDED.span_otel_id,
    error_stack      = COALESCE(EXCLUDED.error_stack, public.error_snapshots.error_stack),
    severity         = EXCLUDED.severity
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 5. Update get_error_heatmap with diagnostic severity + severity filter
DROP FUNCTION IF EXISTS public.get_error_heatmap(uuid, text);

CREATE FUNCTION public.get_error_heatmap(
  p_project_id       uuid,
  p_since            text DEFAULT '7 days',
  p_severity_filter  text DEFAULT NULL
)
RETURNS TABLE (
  code_node_id      uuid,
  error_count       bigint,
  unique_errors     bigint,
  last_error_at     timestamptz,
  top_error_type    text,
  top_error_message text,
  severity          text,
  heat_level        text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.code_node_id,
    COUNT(*)::bigint                       AS error_count,
    COUNT(DISTINCT e.fingerprint)::bigint  AS unique_errors,
    MAX(e.last_seen_at)                    AS last_error_at,
    (
      SELECT e2.error_type FROM public.error_snapshots e2
      WHERE e2.code_node_id = e.code_node_id
        AND e2.project_id   = p_project_id
        AND e2.resolved_at  IS NULL
        AND (p_severity_filter IS NULL OR e2.severity = p_severity_filter)
      ORDER BY e2.occurrence_count DESC LIMIT 1
    ) AS top_error_type,
    (
      SELECT e2.error_message FROM public.error_snapshots e2
      WHERE e2.code_node_id = e.code_node_id
        AND e2.project_id   = p_project_id
        AND e2.resolved_at  IS NULL
        AND (p_severity_filter IS NULL OR e2.severity = p_severity_filter)
      ORDER BY e2.occurrence_count DESC LIMIT 1
    ) AS top_error_message,
    -- Worst diagnostic severity for this node (error > warning > info)
    CASE
      WHEN bool_or(e.severity = 'error')   THEN 'error'
      WHEN bool_or(e.severity = 'warning') THEN 'warning'
      ELSE 'info'
    END AS severity,
    -- Count-based heat level (how "hot" is this node?)
    CASE
      WHEN COUNT(*) >= 50 THEN 'critical'
      WHEN COUNT(*) >= 20 THEN 'high'
      WHEN COUNT(*) >= 5  THEN 'medium'
      ELSE                     'low'
    END AS heat_level
  FROM public.error_snapshots e
  WHERE e.project_id   = p_project_id
    AND e.code_node_id IS NOT NULL
    AND e.resolved_at  IS NULL
    AND e.last_seen_at >= (now() - p_since::interval)
    AND (p_severity_filter IS NULL OR e.severity = p_severity_filter)
  GROUP BY e.code_node_id;
END;
$$;
