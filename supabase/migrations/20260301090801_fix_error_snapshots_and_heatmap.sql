-- Migration: Fix error_snapshots span linkage and heatmap interval cast
-- =====================================================================

-- 1. Add span_otel_id text column to hold the raw OTel span_id string
ALTER TABLE public.error_snapshots
  ADD COLUMN IF NOT EXISTS span_otel_id text;

COMMENT ON COLUMN public.error_snapshots.span_otel_id IS
  'Raw OpenTelemetry span_id string (e.g. "a1b2c3d4e5f6"). Separate from the span_id UUID FK.';

-- 2. Add source column to distinguish static-analysis vs runtime errors
ALTER TABLE public.error_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'runtime';

COMMENT ON COLUMN public.error_snapshots.source IS
  'Origin of the error: ''runtime'' (from OTel trace ingestion) or ''cli-static-analysis''.';

-- 3. Update upsert_error_snapshot to accept both span_otel_id and source
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
  p_source         text     DEFAULT 'runtime'
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
    metadata, span_otel_id, source
  ) VALUES (
    p_project_id, p_code_node_id, p_trace_id, p_span_id,
    p_error_type, p_error_message, p_error_stack, p_fingerprint,
    p_metadata, p_span_otel_id, p_source
  )
  ON CONFLICT (project_id, fingerprint) DO UPDATE SET
    occurrence_count = public.error_snapshots.occurrence_count + 1,
    last_seen_at     = now(),
    trace_id         = EXCLUDED.trace_id,
    span_id          = EXCLUDED.span_id,
    span_otel_id     = EXCLUDED.span_otel_id,
    error_stack      = COALESCE(EXCLUDED.error_stack, public.error_snapshots.error_stack)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 4. Drop and recreate get_error_heatmap with explicit interval cast
DROP FUNCTION IF EXISTS public.get_error_heatmap(uuid, text);
DROP FUNCTION IF EXISTS public.get_error_heatmap(uuid, interval);
DROP FUNCTION IF EXISTS public.get_error_heatmap(uuid, timestamptz);

CREATE FUNCTION public.get_error_heatmap(
  p_project_id  uuid,
  p_since       text DEFAULT '7 days'
)
RETURNS TABLE (
  code_node_id      uuid,
  error_count       bigint,
  unique_errors     bigint,
  last_error_at     timestamptz,
  top_error_type    text,
  top_error_message text,
  severity          text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.code_node_id,
    COUNT(*)::bigint                  AS error_count,
    COUNT(DISTINCT e.fingerprint)::bigint AS unique_errors,
    MAX(e.last_seen_at)               AS last_error_at,
    (
      SELECT e2.error_type FROM public.error_snapshots e2
      WHERE e2.code_node_id = e.code_node_id
        AND e2.project_id   = p_project_id
        AND e2.resolved_at  IS NULL
      ORDER BY e2.occurrence_count DESC LIMIT 1
    ) AS top_error_type,
    (
      SELECT e2.error_message FROM public.error_snapshots e2
      WHERE e2.code_node_id = e.code_node_id
        AND e2.project_id   = p_project_id
        AND e2.resolved_at  IS NULL
      ORDER BY e2.occurrence_count DESC LIMIT 1
    ) AS top_error_message,
    CASE
      WHEN COUNT(*) >= 50 THEN 'critical'
      WHEN COUNT(*) >= 20 THEN 'high'
      WHEN COUNT(*) >= 5  THEN 'medium'
      ELSE                     'low'
    END AS severity
  FROM public.error_snapshots e
  WHERE e.project_id  = p_project_id
    AND e.code_node_id IS NOT NULL
    AND e.resolved_at  IS NULL
    AND e.last_seen_at >= (now() - p_since::interval)
  GROUP BY e.code_node_id;
END;
$$;

-- 5. Add occurrence history function for the error detail page chart
CREATE OR REPLACE FUNCTION public.get_error_occurrence_history(
  p_project_id  uuid,
  p_fingerprint text,
  p_days        int DEFAULT 30
)
RETURNS TABLE (
  day           date,
  occurrences   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    date_trunc('day', s.started_at)::date AS day,
    COUNT(*)::bigint AS occurrences
  FROM public.spans s
  JOIN public.traces t ON t.id = s.trace_id
  JOIN public.error_snapshots es
    ON es.project_id   = p_project_id
   AND es.fingerprint  = p_fingerprint
   AND es.code_node_id = s.code_node_id
  WHERE t.project_id = p_project_id
    AND s.status       = 'error'
    AND s.started_at  >= now() - (p_days || ' days')::interval
  GROUP BY date_trunc('day', s.started_at)::date
  ORDER BY day;
END;
$$;
