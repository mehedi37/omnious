-- Migration: Consolidate function overloads + expand oir_node_type enum
-- =====================================================================

-- 1. Drop match_code_nodes overload 1 (query_embedding, match_project_id ordering)
--    Callers have been switched to overload 2 (p_project_id, query_embedding)
--    which returns signature + metadata — more useful for AI context.
DROP FUNCTION IF EXISTS public.match_code_nodes(
  "extensions"."vector", uuid, double precision, integer
);

-- 2. Drop upsert_error_snapshot overload 1 (9-param version)
--    Callers now pass p_span_otel_id + p_source, using the 11-param version.
DROP FUNCTION IF EXISTS public.upsert_error_snapshot(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb
);

-- 3. Add language column to error_snapshots for multi-language fingerprinting
ALTER TABLE public.error_snapshots
  ADD COLUMN IF NOT EXISTS language text;

COMMENT ON COLUMN public.error_snapshots.language IS
  'Programming language of the associated code (e.g. typescript, python, go). Used for language-aware error fingerprinting.';

-- 4. Expand oir_node_type enum with multi-language types
--    These cover Go structs, Python protocols, Java interfaces, C# namespaces, etc.
--    NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
--    Supabase migrations run outside transactions by default.
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'struct';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'enum';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'interface';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'namespace';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'trait';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'protocol';
ALTER TYPE public.oir_node_type ADD VALUE IF NOT EXISTS 'package';
