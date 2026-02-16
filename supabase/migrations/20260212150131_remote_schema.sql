


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "ltree" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";






CREATE TYPE "public"."ai_session_type" AS ENUM (
    'explain_flow',
    'why_broke',
    'fix_it',
    'general',
    'security_scan',
    'translate'
);


ALTER TYPE "public"."ai_session_type" OWNER TO "postgres";


CREATE TYPE "public"."git_provider" AS ENUM (
    'github',
    'gitlab',
    'bitbucket',
    'local'
);


ALTER TYPE "public"."git_provider" OWNER TO "postgres";


CREATE TYPE "public"."oir_edge_type" AS ENUM (
    'calls',
    'imports',
    'extends',
    'implements',
    'renders',
    'routes_to',
    'queries',
    'emits_event',
    'subscribes_to',
    'redirects_to',
    'uses',
    'exports'
);


ALTER TYPE "public"."oir_edge_type" OWNER TO "postgres";


CREATE TYPE "public"."oir_node_type" AS ENUM (
    'module',
    'component',
    'function',
    'class',
    'route',
    'middleware',
    'database_query',
    'event_emitter',
    'event_listener',
    'external_api',
    'variable',
    'type_def'
);


ALTER TYPE "public"."oir_node_type" OWNER TO "postgres";


CREATE TYPE "public"."project_status" AS ENUM (
    'active',
    'archived',
    'importing',
    'error'
);


ALTER TYPE "public"."project_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_plan" AS ENUM (
    'free',
    'pro',
    'team',
    'enterprise'
);


ALTER TYPE "public"."subscription_plan" OWNER TO "postgres";


CREATE TYPE "public"."trace_status" AS ENUM (
    'ok',
    'error',
    'timeout',
    'partial'
);


ALTER TYPE "public"."trace_status" OWNER TO "postgres";


CREATE TYPE "public"."workspace_role" AS ENUM (
    'owner',
    'admin',
    'member',
    'viewer'
);


ALTER TYPE "public"."workspace_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."get_workspace_role"("ws_id" "uuid") RETURNS "public"."workspace_role"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  r public.workspace_role;
begin
  select role into r from public.workspace_members
  where workspace_id = ws_id
    and user_id = (select auth.uid());
  return r;
end;
$$;


ALTER FUNCTION "private"."get_workspace_role"("ws_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."has_project_access"("proj_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1
    from public.projects p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = proj_id
      and wm.user_id = (select auth.uid())
  );
end;
$$;


ALTER FUNCTION "private"."has_project_access"("proj_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_workspace_member"("ws_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = (select auth.uid())
  );
end;
$$;


ALTER FUNCTION "private"."is_workspace_member"("ws_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_quota integer;
  v_used bigint;
  v_workspace_id uuid;
begin
  select trace_quota, workspace_id into v_quota, v_workspace_id
  from public.projects where id = p_project_id;

  if v_quota is null then return false; end if;

  select count(*) into v_used
  from public.traces
  where project_id = p_project_id
    and started_at >= date_trunc('month', now());

  return v_used < v_quota;
end;
$$;


ALTER FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") IS 'Check if a project is within its monthly trace ingestion quota.';



CREATE OR REPLACE FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" interval DEFAULT '7 days'::interval) RETURNS TABLE("code_node_id" "uuid", "node_name" "text", "node_type" "public"."oir_node_type", "file_path" "text", "error_count" bigint, "unique_errors" bigint, "last_error_at" timestamp with time zone, "severity" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select
    es.code_node_id,
    cn.name as node_name,
    cn.type as node_type,
    cn.file_path,
    sum(es.occurrence_count) as error_count,
    count(distinct es.fingerprint) as unique_errors,
    max(es.last_seen_at) as last_error_at,
    case
      when sum(es.occurrence_count) > 100 then 'critical'
      when sum(es.occurrence_count) > 25  then 'high'
      when sum(es.occurrence_count) > 5   then 'medium'
      else 'low'
    end as severity
  from error_snapshots es
  join code_nodes cn on cn.id = es.code_node_id
  where es.project_id = p_project_id
    and es.last_seen_at > now() - p_since
    and es.resolved_at is null
  group by es.code_node_id, cn.name, cn.type, cn.file_path;
$$;


ALTER FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone DEFAULT ("now"() - '24:00:00'::interval)) RETURNS TABLE("code_node_id" "uuid", "node_name" "text", "node_type" "public"."oir_node_type", "file_path" "text", "error_count" bigint, "last_error_at" timestamp with time zone, "top_error_type" "text", "top_error_message" "text")
    LANGUAGE "sql" STABLE
    AS $$
  select
    es.code_node_id,
    cn.name as node_name,
    cn.type as node_type,
    cn.file_path,
    sum(es.occurrence_count)::bigint as error_count,
    max(es.last_seen_at) as last_error_at,
    (array_agg(es.error_type order by es.occurrence_count desc))[1] as top_error_type,
    (array_agg(es.error_message order by es.occurrence_count desc))[1] as top_error_message
  from public.error_snapshots es
  join public.code_nodes cn on cn.id = es.code_node_id
  where es.project_id = p_project_id
    and es.code_node_id is not null
    and es.resolved_at is null
    and es.last_seen_at >= p_since
  group by es.code_node_id, cn.name, cn.type, cn.file_path
  order by error_count desc;
$$;


ALTER FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone) IS 'Aggregated error data per code node for the Red Zone heatmap overlay.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_workspace_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, accepted_at)
  values (new.id, new.owner_id, 'owner', now());
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_workspace_created"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_code_nodes"("query_embedding" "extensions"."vector", "match_project_id" "uuid", "match_threshold" double precision DEFAULT 0.78, "match_count" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "oir_id" "text", "name" "text", "type" "public"."oir_node_type", "file_path" "text", "line_start" integer, "line_end" integer, "similarity" double precision)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select
    cn.id,
    cn.oir_id,
    cn.name,
    cn.type,
    cn.file_path,
    cn.line_start,
    cn.line_end,
    1 - (cn.embedding <=> query_embedding) as similarity
  from code_nodes cn
  where cn.project_id = match_project_id
    and cn.embedding is not null
    and 1 - (cn.embedding <=> query_embedding) > match_threshold
  order by cn.embedding <=> query_embedding
  limit match_count;
$$;


ALTER FUNCTION "public"."match_code_nodes"("query_embedding" "extensions"."vector", "match_project_id" "uuid", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_code_nodes"("p_project_id" "uuid", "query_embedding" "extensions"."vector", "match_threshold" double precision DEFAULT 0.7, "match_count" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "oir_id" "text", "type" "public"."oir_node_type", "name" "text", "file_path" "text", "signature" "text", "metadata" "jsonb", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  select
    cn.id,
    cn.oir_id,
    cn.type,
    cn.name,
    cn.file_path,
    cn.signature,
    cn.metadata,
    1 - (cn.embedding <=> query_embedding) as similarity
  from public.code_nodes cn
  where cn.project_id = p_project_id
    and cn.embedding is not null
    and 1 - (cn.embedding <=> query_embedding) > match_threshold
  order by cn.embedding <=> query_embedding asc
  limit least(match_count, 200);
$$;


ALTER FUNCTION "public"."match_code_nodes"("p_project_id" "uuid", "query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."match_code_nodes"("p_project_id" "uuid", "query_embedding" "extensions"."vector", "match_threshold" double precision, "match_count" integer) IS 'Semantic search over code nodes using pgvector cosine similarity.';



CREATE OR REPLACE FUNCTION "public"."traverse_graph"("p_node_id" "uuid", "p_direction" "text" DEFAULT 'downstream'::"text", "p_max_depth" integer DEFAULT 5) RETURNS TABLE("depth" integer, "node_id" "uuid", "node_name" "text", "node_type" "public"."oir_node_type", "edge_type" "public"."oir_edge_type", "parent_node_id" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  with recursive graph as (
    select
      0 as depth,
      cn.id as node_id,
      cn.name as node_name,
      cn.type as node_type,
      null::oir_edge_type as edge_type,
      null::uuid as parent_node_id
    from code_nodes cn
    where cn.id = p_node_id

    union all

    select
      g.depth + 1,
      case when p_direction = 'downstream' then ce.target_node_id else ce.source_node_id end,
      cn2.name,
      cn2.type,
      ce.type,
      case when p_direction = 'downstream' then ce.source_node_id else ce.target_node_id end
    from graph g
    join code_edges ce on (
      case when p_direction = 'downstream'
           then ce.source_node_id = g.node_id
           else ce.target_node_id = g.node_id
      end
    )
    join code_nodes cn2 on cn2.id = (
      case when p_direction = 'downstream' then ce.target_node_id else ce.source_node_id end
    )
    where g.depth < p_max_depth
  )
  select distinct on (graph.node_id) graph.* from graph;
$$;


ALTER FUNCTION "public"."traverse_graph"("p_node_id" "uuid", "p_direction" "text", "p_max_depth" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_id uuid;
begin
  insert into public.error_snapshots (
    project_id, code_node_id, trace_id, span_id,
    error_type, error_message, error_stack, fingerprint, metadata
  ) values (
    p_project_id, p_code_node_id, p_trace_id, p_span_id,
    p_error_type, p_error_message, p_error_stack, p_fingerprint, p_metadata
  )
  on conflict (project_id, fingerprint) do update set
    occurrence_count = public.error_snapshots.occurrence_count + 1,
    last_seen_at = now(),
    trace_id = excluded.trace_id,
    span_id = excluded.span_id,
    error_stack = coalesce(excluded.error_stack, public.error_snapshots.error_stack)
  returning id into v_id;
  return v_id;
end;
$$;


ALTER FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb") IS 'Insert or increment error snapshot using fingerprint dedup.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "api_key_id" "uuid",
    "type" "public"."ai_session_type" NOT NULL,
    "context_node_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "context_trace_id" "uuid",
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "model" "text",
    "prompt_tokens" integer DEFAULT 0 NOT NULL,
    "completion_tokens" integer DEFAULT 0 NOT NULL,
    "total_tokens" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_sessions" IS 'AI debugging sessions — Explain Flow, Why Broke, Fix It, etc.';



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid",
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "resource_type" "text",
    "resource_id" "uuid",
    "changes" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Immutable audit trail for compliance, debugging, and security review.';



CREATE TABLE IF NOT EXISTS "public"."billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "quantity" bigint DEFAULT 1 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "period_start" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_events" IS 'Usage-based billing events for quota tracking and invoicing.';



CREATE TABLE IF NOT EXISTS "public"."code_edges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "source_node_id" "uuid" NOT NULL,
    "target_node_id" "uuid" NOT NULL,
    "type" "public"."oir_edge_type" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."code_edges" OWNER TO "postgres";


COMMENT ON TABLE "public"."code_edges" IS 'OIR edge — a relationship between two code nodes (calls, imports, renders, etc.).';



CREATE TABLE IF NOT EXISTS "public"."code_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "oir_id" "text" NOT NULL,
    "type" "public"."oir_node_type" NOT NULL,
    "name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "line_start" integer,
    "line_end" integer,
    "tree_path" "public"."ltree",
    "signature" "text",
    "doc_comment" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "embedding" "extensions"."vector"(1536),
    "content_hash" "text" NOT NULL,
    "oir_version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."code_nodes" OWNER TO "postgres";


COMMENT ON TABLE "public"."code_nodes" IS 'OIR node — a function, component, route, query, etc. in the code graph.';



CREATE TABLE IF NOT EXISTS "public"."error_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "code_node_id" "uuid",
    "trace_id" "uuid",
    "span_id" "uuid",
    "error_type" "text",
    "error_message" "text" NOT NULL,
    "error_stack" "text",
    "fingerprint" "text" NOT NULL,
    "occurrence_count" integer DEFAULT 1 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."error_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."error_snapshots" IS 'Aggregated error events for the Red Zone heatmap overlay on the graph.';



CREATE TABLE IF NOT EXISTS "public"."parser_registry" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "language" "text" NOT NULL,
    "framework" "text",
    "version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "author_id" "uuid",
    "is_official" boolean DEFAULT false NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "config_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "supported_extensions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "downloads" integer DEFAULT 0 NOT NULL,
    "rating" numeric(3,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."parser_registry" OWNER TO "postgres";


COMMENT ON TABLE "public"."parser_registry" IS 'Registry of available code parsers (official + community marketplace).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "avatar_url" "text",
    "plan" "public"."subscription_plan" DEFAULT 'free'::"public"."subscription_plan" NOT NULL,
    "plan_expires_at" timestamp with time zone,
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Extended user profile linked 1:1 with auth.users.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "status" "public"."project_status" DEFAULT 'active'::"public"."project_status" NOT NULL,
    "git_provider" "public"."git_provider",
    "git_url" "text",
    "git_branch" "text" DEFAULT 'main'::"text",
    "git_token_enc" "text",
    "primary_language" "text",
    "framework" "text",
    "detected_stack" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "oir_version" "text",
    "last_indexed_at" timestamp with time zone,
    "last_index_hash" "text",
    "api_key" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "otel_endpoint" "text",
    "trace_quota" integer DEFAULT 5000 NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON TABLE "public"."projects" IS 'A web application being analyzed/debugged. One project per repo.';



CREATE TABLE IF NOT EXISTS "public"."saved_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "viewport" "jsonb",
    "visible_nodes" "uuid"[],
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_shared" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_views" OWNER TO "postgres";


COMMENT ON TABLE "public"."saved_views" IS 'User-saved snapshots of the graph viewport and filter state.';



CREATE TABLE IF NOT EXISTS "public"."spans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "trace_id" "uuid" NOT NULL,
    "span_id" "text" NOT NULL,
    "parent_span_id" "text",
    "code_node_id" "uuid",
    "service_name" "text",
    "operation" "text" NOT NULL,
    "kind" "text",
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_ms" double precision,
    "status" "public"."trace_status" DEFAULT 'ok'::"public"."trace_status" NOT NULL,
    "error_message" "text",
    "error_stack" "text",
    "attributes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."spans" OWNER TO "postgres";


COMMENT ON TABLE "public"."spans" IS 'Individual operation within a trace — maps to a code node for graph overlay.';



CREATE TABLE IF NOT EXISTS "public"."traces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "trace_id" "text" NOT NULL,
    "root_service" "text",
    "root_operation" "text",
    "http_method" "text",
    "http_url" "text",
    "http_status" smallint,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_ms" double precision,
    "status" "public"."trace_status" DEFAULT 'ok'::"public"."trace_status" NOT NULL,
    "error_message" "text",
    "tags" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."traces" OWNER TO "postgres";


COMMENT ON TABLE "public"."traces" IS 'A complete request lifecycle from frontend to database and back.';



CREATE TABLE IF NOT EXISTS "public"."user_api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "label" "text" DEFAULT 'Default'::"text" NOT NULL,
    "encrypted_key" "text" NOT NULL,
    "key_prefix" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_api_keys" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_api_keys" IS 'BYOK: user-supplied AI API keys, encrypted at rest by the application.';



CREATE TABLE IF NOT EXISTS "public"."workspace_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."workspace_role" DEFAULT 'member'::"public"."workspace_role" NOT NULL,
    "invited_email" "text",
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspace_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspace_members" IS 'Maps users to workspaces with RBAC roles.';



CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "plan" "public"."subscription_plan" DEFAULT 'free'::"public"."subscription_plan" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


COMMENT ON TABLE "public"."workspaces" IS 'Top level container — a team or personal workspace.';



ALTER TABLE ONLY "public"."ai_sessions"
    ADD CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."code_edges"
    ADD CONSTRAINT "code_edges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."code_edges"
    ADD CONSTRAINT "code_edges_project_id_source_node_id_target_node_id_type_key" UNIQUE ("project_id", "source_node_id", "target_node_id", "type");



ALTER TABLE ONLY "public"."code_nodes"
    ADD CONSTRAINT "code_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."code_nodes"
    ADD CONSTRAINT "code_nodes_project_id_oir_id_key" UNIQUE ("project_id", "oir_id");



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parser_registry"
    ADD CONSTRAINT "parser_registry_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parser_registry"
    ADD CONSTRAINT "parser_registry_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_slug_key" UNIQUE ("workspace_id", "slug");



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spans"
    ADD CONSTRAINT "spans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."traces"
    ADD CONSTRAINT "traces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."traces"
    ADD CONSTRAINT "traces_project_id_trace_id_key" UNIQUE ("project_id", "trace_id");



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_user_id_provider_label_key" UNIQUE ("user_id", "provider", "label");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_user_id_key" UNIQUE ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_slug_key" UNIQUE ("slug");



CREATE INDEX "idx_ai_sessions_api_key" ON "public"."ai_sessions" USING "btree" ("api_key_id");



CREATE INDEX "idx_ai_sessions_context_trace" ON "public"."ai_sessions" USING "btree" ("context_trace_id");



CREATE INDEX "idx_ai_sessions_project" ON "public"."ai_sessions" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_ai_sessions_user" ON "public"."ai_sessions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_log_resource" ON "public"."audit_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_audit_log_user" ON "public"."audit_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_audit_log_workspace" ON "public"."audit_log" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "idx_billing_events_workspace_period" ON "public"."billing_events" USING "btree" ("workspace_id", "period_start", "event_type");



CREATE INDEX "idx_code_edges_project" ON "public"."code_edges" USING "btree" ("project_id");



CREATE INDEX "idx_code_edges_source" ON "public"."code_edges" USING "btree" ("source_node_id");



CREATE INDEX "idx_code_edges_target" ON "public"."code_edges" USING "btree" ("target_node_id");



CREATE INDEX "idx_code_nodes_embedding" ON "public"."code_nodes" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops") WITH ("m"='16', "ef_construction"='64');



CREATE INDEX "idx_code_nodes_file_path" ON "public"."code_nodes" USING "btree" ("project_id", "file_path");



CREATE INDEX "idx_code_nodes_name_trgm" ON "public"."code_nodes" USING "gin" ("name" "public"."gin_trgm_ops");



CREATE INDEX "idx_code_nodes_project" ON "public"."code_nodes" USING "btree" ("project_id");



CREATE INDEX "idx_code_nodes_tree_path" ON "public"."code_nodes" USING "gist" ("tree_path");



CREATE UNIQUE INDEX "idx_error_snapshots_fingerprint" ON "public"."error_snapshots" USING "btree" ("project_id", "fingerprint");



CREATE INDEX "idx_error_snapshots_node" ON "public"."error_snapshots" USING "btree" ("code_node_id") WHERE ("code_node_id" IS NOT NULL);



CREATE INDEX "idx_error_snapshots_resolved_by" ON "public"."error_snapshots" USING "btree" ("resolved_by");



CREATE INDEX "idx_error_snapshots_span" ON "public"."error_snapshots" USING "btree" ("span_id");



CREATE INDEX "idx_error_snapshots_trace" ON "public"."error_snapshots" USING "btree" ("trace_id");



CREATE INDEX "idx_error_snapshots_unresolved" ON "public"."error_snapshots" USING "btree" ("project_id", "last_seen_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "idx_parser_registry_author" ON "public"."parser_registry" USING "btree" ("author_id");



CREATE UNIQUE INDEX "idx_projects_api_key" ON "public"."projects" USING "btree" ("api_key");



CREATE INDEX "idx_saved_views_project" ON "public"."saved_views" USING "btree" ("project_id");



CREATE INDEX "idx_saved_views_user" ON "public"."saved_views" USING "btree" ("user_id");



CREATE INDEX "idx_spans_code_node" ON "public"."spans" USING "btree" ("code_node_id") WHERE ("code_node_id" IS NOT NULL);



CREATE INDEX "idx_spans_project_time" ON "public"."spans" USING "btree" ("project_id", "started_at" DESC);



CREATE INDEX "idx_spans_status_error" ON "public"."spans" USING "btree" ("project_id", "status") WHERE ("status" = 'error'::"public"."trace_status");



CREATE INDEX "idx_spans_trace" ON "public"."spans" USING "btree" ("trace_id");



CREATE INDEX "idx_traces_http_url" ON "public"."traces" USING "btree" ("project_id", "http_url");



CREATE INDEX "idx_traces_project_time" ON "public"."traces" USING "btree" ("project_id", "started_at" DESC);



CREATE INDEX "idx_traces_status" ON "public"."traces" USING "btree" ("project_id", "status") WHERE ("status" = 'error'::"public"."trace_status");



CREATE INDEX "idx_workspace_members_user" ON "public"."workspace_members" USING "btree" ("user_id");



CREATE INDEX "idx_workspaces_owner" ON "public"."workspaces" USING "btree" ("owner_id");



CREATE OR REPLACE TRIGGER "handle_ai_sessions_updated_at" BEFORE UPDATE ON "public"."ai_sessions" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_code_nodes_updated_at" BEFORE UPDATE ON "public"."code_nodes" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_parser_registry_updated_at" BEFORE UPDATE ON "public"."parser_registry" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_saved_views_updated_at" BEFORE UPDATE ON "public"."saved_views" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_user_api_keys_updated_at" BEFORE UPDATE ON "public"."user_api_keys" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_workspace_members_updated_at" BEFORE UPDATE ON "public"."workspace_members" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_workspaces_updated_at" BEFORE UPDATE ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "on_workspace_created" AFTER INSERT ON "public"."workspaces" FOR EACH ROW EXECUTE FUNCTION "public"."handle_workspace_created"();



ALTER TABLE ONLY "public"."ai_sessions"
    ADD CONSTRAINT "ai_sessions_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."user_api_keys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_sessions"
    ADD CONSTRAINT "ai_sessions_context_trace_id_fkey" FOREIGN KEY ("context_trace_id") REFERENCES "public"."traces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_sessions"
    ADD CONSTRAINT "ai_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_sessions"
    ADD CONSTRAINT "ai_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_events"
    ADD CONSTRAINT "billing_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."code_edges"
    ADD CONSTRAINT "code_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."code_edges"
    ADD CONSTRAINT "code_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "public"."code_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."code_edges"
    ADD CONSTRAINT "code_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "public"."code_nodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."code_nodes"
    ADD CONSTRAINT "code_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_code_node_id_fkey" FOREIGN KEY ("code_node_id") REFERENCES "public"."code_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_span_id_fkey" FOREIGN KEY ("span_id") REFERENCES "public"."spans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."error_snapshots"
    ADD CONSTRAINT "error_snapshots_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."parser_registry"
    ADD CONSTRAINT "parser_registry_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spans"
    ADD CONSTRAINT "spans_code_node_id_fkey" FOREIGN KEY ("code_node_id") REFERENCES "public"."code_nodes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spans"
    ADD CONSTRAINT "spans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spans"
    ADD CONSTRAINT "spans_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."traces"
    ADD CONSTRAINT "traces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_api_keys"
    ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_members"
    ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can view public parsers" ON "public"."parser_registry" FOR SELECT TO "authenticated" USING ((("is_public" = true) OR (( SELECT "auth"."uid"() AS "uid") = "author_id")));



CREATE POLICY "Authenticated users can create workspaces" ON "public"."workspaces" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Authors can manage own parsers" ON "public"."parser_registry" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "author_id"));



CREATE POLICY "Authors can update own parsers" ON "public"."parser_registry" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "author_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "author_id"));



CREATE POLICY "Members can view their workspaces" ON "public"."workspaces" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_workspace_member"("workspaces"."id") AS "is_workspace_member"));



CREATE POLICY "Members can view workspace members" ON "public"."workspace_members" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_workspace_member"("workspace_members"."workspace_id") AS "is_workspace_member"));



CREATE POLICY "Only owner can delete workspace" ON "public"."workspaces" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "owner_id"));



CREATE POLICY "Only owners/admins can delete projects" ON "public"."projects" FOR DELETE TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("projects"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can create projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."get_workspace_role"("projects"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role", 'member'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can manage members" ON "public"."workspace_members" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."get_workspace_role"("workspace_members"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can remove members" ON "public"."workspace_members" FOR DELETE TO "authenticated" USING (((( SELECT "private"."get_workspace_role"("workspace_members"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "Owners/admins can update members" ON "public"."workspace_members" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("workspace_members"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"]))) WITH CHECK ((( SELECT "private"."get_workspace_role"("workspace_members"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can update workspace" ON "public"."workspaces" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("workspaces"."id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"]))) WITH CHECK ((( SELECT "private"."get_workspace_role"("workspaces"."id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can view audit log" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("audit_log"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins can view billing" ON "public"."billing_events" FOR SELECT TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("billing_events"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role"])));



CREATE POLICY "Owners/admins/members can update projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."get_workspace_role"("projects"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role", 'member'::"public"."workspace_role"]))) WITH CHECK ((( SELECT "private"."get_workspace_role"("projects"."workspace_id") AS "get_workspace_role") = ANY (ARRAY['owner'::"public"."workspace_role", 'admin'::"public"."workspace_role", 'member'::"public"."workspace_role"])));



CREATE POLICY "Project members can delete code edges" ON "public"."code_edges" FOR DELETE TO "authenticated" USING (( SELECT "private"."has_project_access"("code_edges"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can delete code nodes" ON "public"."code_nodes" FOR DELETE TO "authenticated" USING (( SELECT "private"."has_project_access"("code_nodes"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can insert spans" ON "public"."spans" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."has_project_access"("spans"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can insert traces" ON "public"."traces" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."has_project_access"("traces"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can manage code edges" ON "public"."code_edges" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."has_project_access"("code_edges"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can manage code nodes" ON "public"."code_nodes" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."has_project_access"("code_nodes"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can manage errors" ON "public"."error_snapshots" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."has_project_access"("error_snapshots"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can update code edges" ON "public"."code_edges" FOR UPDATE TO "authenticated" USING (( SELECT "private"."has_project_access"("code_edges"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can update code nodes" ON "public"."code_nodes" FOR UPDATE TO "authenticated" USING (( SELECT "private"."has_project_access"("code_nodes"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can update errors" ON "public"."error_snapshots" FOR UPDATE TO "authenticated" USING (( SELECT "private"."has_project_access"("error_snapshots"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can view code edges" ON "public"."code_edges" FOR SELECT TO "authenticated" USING (( SELECT "private"."has_project_access"("code_edges"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can view code nodes" ON "public"."code_nodes" FOR SELECT TO "authenticated" USING (( SELECT "private"."has_project_access"("code_nodes"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can view errors" ON "public"."error_snapshots" FOR SELECT TO "authenticated" USING (( SELECT "private"."has_project_access"("error_snapshots"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can view spans" ON "public"."spans" FOR SELECT TO "authenticated" USING (( SELECT "private"."has_project_access"("spans"."project_id") AS "has_project_access"));



CREATE POLICY "Project members can view traces" ON "public"."traces" FOR SELECT TO "authenticated" USING (( SELECT "private"."has_project_access"("traces"."project_id") AS "has_project_access"));



CREATE POLICY "Users can create AI sessions" ON "public"."ai_sessions" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ( SELECT "private"."has_project_access"("ai_sessions"."project_id") AS "has_project_access")));



CREATE POLICY "Users can create own API keys" ON "public"."user_api_keys" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can create saved views" ON "public"."saved_views" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ( SELECT "private"."has_project_access"("saved_views"."project_id") AS "has_project_access")));



CREATE POLICY "Users can delete own API keys" ON "public"."user_api_keys" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete own saved views" ON "public"."saved_views" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own AI sessions" ON "public"."ai_sessions" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own API keys" ON "public"."user_api_keys" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update own saved views" ON "public"."saved_views" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view any profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can view own AI sessions" ON "public"."ai_sessions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own API keys" ON "public"."user_api_keys" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own saved views or shared views" ON "public"."saved_views" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (("is_shared" = true) AND ( SELECT "private"."has_project_access"("saved_views"."project_id") AS "has_project_access"))));



CREATE POLICY "Workspace members can view projects" ON "public"."projects" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_workspace_member"("projects"."workspace_id") AS "is_workspace_member"));



ALTER TABLE "public"."ai_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."code_edges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."code_nodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parser_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."spans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."traces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
















































GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";



GRANT ALL ON FUNCTION "public"."lquery_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."lquery_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."lquery_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lquery_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."lquery_out"("public"."lquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."lquery_out"("public"."lquery") TO "anon";
GRANT ALL ON FUNCTION "public"."lquery_out"("public"."lquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lquery_out"("public"."lquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."lquery_recv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."lquery_recv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."lquery_recv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lquery_recv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."lquery_send"("public"."lquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."lquery_send"("public"."lquery") TO "anon";
GRANT ALL ON FUNCTION "public"."lquery_send"("public"."lquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lquery_send"("public"."lquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_out"("public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_out"("public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_out"("public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_out"("public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_recv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_recv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_recv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_recv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_send"("public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_send"("public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_send"("public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_send"("public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_gist_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_gist_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_gist_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_gist_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_gist_out"("public"."ltree_gist") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_gist_out"("public"."ltree_gist") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_gist_out"("public"."ltree_gist") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_gist_out"("public"."ltree_gist") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_out"("public"."ltxtquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_out"("public"."ltxtquery") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_out"("public"."ltxtquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_out"("public"."ltxtquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_recv"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_recv"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_recv"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_recv"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_send"("public"."ltxtquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_send"("public"."ltxtquery") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_send"("public"."ltxtquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_send"("public"."ltxtquery") TO "service_role";





































































































































































































































































































































































































































































GRANT ALL ON FUNCTION "public"."_lt_q_regex"("public"."ltree"[], "public"."lquery"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_lt_q_regex"("public"."ltree"[], "public"."lquery"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_lt_q_regex"("public"."ltree"[], "public"."lquery"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lt_q_regex"("public"."ltree"[], "public"."lquery"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_lt_q_rregex"("public"."lquery"[], "public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_lt_q_rregex"("public"."lquery"[], "public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_lt_q_rregex"("public"."lquery"[], "public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lt_q_rregex"("public"."lquery"[], "public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltq_extract_regex"("public"."ltree"[], "public"."lquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltq_extract_regex"("public"."ltree"[], "public"."lquery") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltq_extract_regex"("public"."ltree"[], "public"."lquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltq_extract_regex"("public"."ltree"[], "public"."lquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltq_regex"("public"."ltree"[], "public"."lquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltq_regex"("public"."ltree"[], "public"."lquery") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltq_regex"("public"."ltree"[], "public"."lquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltq_regex"("public"."ltree"[], "public"."lquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltq_rregex"("public"."lquery", "public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltq_rregex"("public"."lquery", "public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_ltq_rregex"("public"."lquery", "public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltq_rregex"("public"."lquery", "public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_consistent"("internal", "public"."ltree"[], smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_consistent"("internal", "public"."ltree"[], smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_consistent"("internal", "public"."ltree"[], smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_consistent"("internal", "public"."ltree"[], smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_extract_isparent"("public"."ltree"[], "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_extract_isparent"("public"."ltree"[], "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_extract_isparent"("public"."ltree"[], "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_extract_isparent"("public"."ltree"[], "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_extract_risparent"("public"."ltree"[], "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_extract_risparent"("public"."ltree"[], "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_extract_risparent"("public"."ltree"[], "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_extract_risparent"("public"."ltree"[], "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_gist_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_gist_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_gist_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_gist_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_isparent"("public"."ltree"[], "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_isparent"("public"."ltree"[], "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_isparent"("public"."ltree"[], "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_isparent"("public"."ltree"[], "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_r_isparent"("public"."ltree", "public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_r_isparent"("public"."ltree", "public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_r_isparent"("public"."ltree", "public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_r_isparent"("public"."ltree", "public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_r_risparent"("public"."ltree", "public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_r_risparent"("public"."ltree", "public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_r_risparent"("public"."ltree", "public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_r_risparent"("public"."ltree", "public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_risparent"("public"."ltree"[], "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_risparent"("public"."ltree"[], "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_risparent"("public"."ltree"[], "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_risparent"("public"."ltree"[], "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltree_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltree_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltree_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltree_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltxtq_exec"("public"."ltree"[], "public"."ltxtquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltxtq_exec"("public"."ltree"[], "public"."ltxtquery") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltxtq_exec"("public"."ltree"[], "public"."ltxtquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltxtq_exec"("public"."ltree"[], "public"."ltxtquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltxtq_extract_exec"("public"."ltree"[], "public"."ltxtquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltxtq_extract_exec"("public"."ltree"[], "public"."ltxtquery") TO "anon";
GRANT ALL ON FUNCTION "public"."_ltxtq_extract_exec"("public"."ltree"[], "public"."ltxtquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltxtq_extract_exec"("public"."ltree"[], "public"."ltxtquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ltxtq_rexec"("public"."ltxtquery", "public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ltxtq_rexec"("public"."ltxtquery", "public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_ltxtq_rexec"("public"."ltxtquery", "public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ltxtq_rexec"("public"."ltxtquery", "public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_trace_quota"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" interval) TO "anon";
GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_error_heatmap"("p_project_id" "uuid", "p_since" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_workspace_created"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_workspace_created"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_workspace_created"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hash_ltree"("public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."hash_ltree"("public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."hash_ltree"("public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hash_ltree"("public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."hash_ltree_extended"("public"."ltree", bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."hash_ltree_extended"("public"."ltree", bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."hash_ltree_extended"("public"."ltree", bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hash_ltree_extended"("public"."ltree", bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."index"("public"."ltree", "public"."ltree", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lca"("public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."lt_q_regex"("public"."ltree", "public"."lquery"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."lt_q_regex"("public"."ltree", "public"."lquery"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."lt_q_regex"("public"."ltree", "public"."lquery"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lt_q_regex"("public"."ltree", "public"."lquery"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."lt_q_rregex"("public"."lquery"[], "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."lt_q_rregex"("public"."lquery"[], "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."lt_q_rregex"("public"."lquery"[], "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lt_q_rregex"("public"."lquery"[], "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltq_regex"("public"."ltree", "public"."lquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltq_regex"("public"."ltree", "public"."lquery") TO "anon";
GRANT ALL ON FUNCTION "public"."ltq_regex"("public"."ltree", "public"."lquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltq_regex"("public"."ltree", "public"."lquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltq_rregex"("public"."lquery", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltq_rregex"("public"."lquery", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltq_rregex"("public"."lquery", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltq_rregex"("public"."lquery", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree2text"("public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree2text"("public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree2text"("public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree2text"("public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_addltree"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_addltree"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_addltree"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_addltree"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_addtext"("public"."ltree", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_addtext"("public"."ltree", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_addtext"("public"."ltree", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_addtext"("public"."ltree", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_cmp"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_cmp"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_cmp"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_cmp"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_consistent"("internal", "public"."ltree", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_consistent"("internal", "public"."ltree", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_consistent"("internal", "public"."ltree", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_consistent"("internal", "public"."ltree", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_eq"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_eq"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_eq"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_eq"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_ge"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_ge"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_ge"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_ge"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_gist_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_gist_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_gist_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_gist_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_gt"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_gt"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_gt"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_gt"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_isparent"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_isparent"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_isparent"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_isparent"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_le"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_le"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_le"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_le"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_lt"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_lt"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_lt"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_lt"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_ne"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_ne"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_ne"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_ne"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_risparent"("public"."ltree", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_risparent"("public"."ltree", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_risparent"("public"."ltree", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_risparent"("public"."ltree", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_same"("public"."ltree_gist", "public"."ltree_gist", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_textadd"("text", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_textadd"("text", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_textadd"("text", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_textadd"("text", "public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltree_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltree_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ltree_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltree_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltreeparentsel"("internal", "oid", "internal", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."ltreeparentsel"("internal", "oid", "internal", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ltreeparentsel"("internal", "oid", "internal", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltreeparentsel"("internal", "oid", "internal", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_exec"("public"."ltree", "public"."ltxtquery") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_exec"("public"."ltree", "public"."ltxtquery") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_exec"("public"."ltree", "public"."ltxtquery") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_exec"("public"."ltree", "public"."ltxtquery") TO "service_role";



GRANT ALL ON FUNCTION "public"."ltxtq_rexec"("public"."ltxtquery", "public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."ltxtq_rexec"("public"."ltxtquery", "public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."ltxtq_rexec"("public"."ltxtquery", "public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ltxtq_rexec"("public"."ltxtquery", "public"."ltree") TO "service_role";









GRANT ALL ON FUNCTION "public"."nlevel"("public"."ltree") TO "postgres";
GRANT ALL ON FUNCTION "public"."nlevel"("public"."ltree") TO "anon";
GRANT ALL ON FUNCTION "public"."nlevel"("public"."ltree") TO "authenticated";
GRANT ALL ON FUNCTION "public"."nlevel"("public"."ltree") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."subltree"("public"."ltree", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subltree"("public"."ltree", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subltree"("public"."ltree", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subltree"("public"."ltree", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subpath"("public"."ltree", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."text2ltree"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."text2ltree"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."text2ltree"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."text2ltree"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."traverse_graph"("p_node_id" "uuid", "p_direction" "text", "p_max_depth" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."traverse_graph"("p_node_id" "uuid", "p_direction" "text", "p_max_depth" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."traverse_graph"("p_node_id" "uuid", "p_direction" "text", "p_max_depth" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_error_snapshot"("p_project_id" "uuid", "p_code_node_id" "uuid", "p_trace_id" "uuid", "p_span_id" "uuid", "p_error_type" "text", "p_error_message" "text", "p_error_stack" "text", "p_fingerprint" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";






























GRANT ALL ON TABLE "public"."ai_sessions" TO "anon";
GRANT ALL ON TABLE "public"."ai_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."billing_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."code_edges" TO "anon";
GRANT ALL ON TABLE "public"."code_edges" TO "authenticated";
GRANT ALL ON TABLE "public"."code_edges" TO "service_role";



GRANT ALL ON TABLE "public"."code_nodes" TO "anon";
GRANT ALL ON TABLE "public"."code_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."code_nodes" TO "service_role";



GRANT ALL ON TABLE "public"."error_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."error_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."error_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."parser_registry" TO "anon";
GRANT ALL ON TABLE "public"."parser_registry" TO "authenticated";
GRANT ALL ON TABLE "public"."parser_registry" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."saved_views" TO "anon";
GRANT ALL ON TABLE "public"."saved_views" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_views" TO "service_role";



GRANT ALL ON TABLE "public"."spans" TO "anon";
GRANT ALL ON TABLE "public"."spans" TO "authenticated";
GRANT ALL ON TABLE "public"."spans" TO "service_role";



GRANT ALL ON TABLE "public"."traces" TO "anon";
GRANT ALL ON TABLE "public"."traces" TO "authenticated";
GRANT ALL ON TABLE "public"."traces" TO "service_role";



GRANT ALL ON TABLE "public"."user_api_keys" TO "anon";
GRANT ALL ON TABLE "public"."user_api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."user_api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_members" TO "anon";
GRANT ALL ON TABLE "public"."workspace_members" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_members" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































