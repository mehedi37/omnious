// ─────────────────────────────────────────────────────────────
// OIR Types — Single Source of Truth
// ─────────────────────────────────────────────────────────────
// This file is the canonical definition for OIR node and edge types.
// All other packages (CLI, backend, frontend) MUST import from here
// instead of defining their own copies.
//
// When adding new types, also create a Supabase migration:
//   ALTER TYPE oir_node_type ADD VALUE 'new_type';
// ─────────────────────────────────────────────────────────────

// ─── Node Types ──────────────────────────────────────────────

/** All OIR node types — kept in sync with Postgres `oir_node_type` enum */
export const OIR_NODE_TYPES = [
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
  'type_def',
  // Multi-language types (added in migration 20260302000000)
  'struct',        // Go structs, C# structs, Rust structs
  'enum',          // Java/C#/TS enums, Python Enum classes
  'interface',     // Java/C#/Go/TS interfaces
  'namespace',     // C# namespaces, TS namespaces, Python packages
  'trait',         // Rust traits, PHP traits, Scala traits
  'protocol',      // Python protocols, Swift protocols
  'package',       // Go packages, Java packages
] as const;

export type OIRNodeType = (typeof OIR_NODE_TYPES)[number];

// ─── Edge Types ──────────────────────────────────────────────

/** All OIR edge types — kept in sync with Postgres `oir_edge_type` enum */
export const OIR_EDGE_TYPES = [
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
  'exports',
] as const;

export type OIREdgeType = (typeof OIR_EDGE_TYPES)[number];

// ─── Node Interface ──────────────────────────────────────────

/** A code node extracted from source by the parser */
export interface OIRNode {
  /** Deterministic ID: hash(file_path + name + type + line_start) */
  oir_id: string;
  type: OIRNodeType;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  doc_comment: string | null;
  metadata: Record<string, unknown>;
  /** SHA-256 of the source code for this node */
  content_hash: string;
}

/** An edge between two OIR nodes */
export interface OIREdge {
  /** References source node's oir_id */
  source_oir_id: string;
  /** References target node's oir_id */
  target_oir_id: string;
  type: OIREdgeType;
  metadata: Record<string, unknown>;
}

/** Result of parsing a single file */
export interface ParseResult {
  nodes: OIRNode[];
  edges: OIREdge[];
  errors: ParseError[];
}

/** Non-fatal parse error */
export interface ParseError {
  file_path: string;
  line: number | null;
  message: string;
}

/** Full OIR index stored in .omnious/index.json */
export interface OIRIndex {
  version: 1;
  timestamp: string;
  project_hash: string;
  files: Record<string, string>; // file_path → content_hash
  nodes: OIRNode[];
  edges: OIREdge[];
  summary: IndexSummary;
}

/** Index summary statistics */
export interface IndexSummary {
  total_files: number;
  total_nodes: number;
  total_edges: number;
  nodes_by_type: Partial<Record<OIRNodeType, number>>;
  edges_by_type: Partial<Record<OIREdgeType, number>>;
  parse_errors: number;
}

/** Push result from the backend */
export interface PushResult {
  project_id: string;
  project_name: string;
  project_slug: string;
  workspace_slug: string | null;
  nodes_upserted: number;
  edges_upserted: number;
  edges_skipped: number;
}

/** Project status from the backend */
export interface ProjectStatus {
  id: string;
  name: string;
  slug: string;
  workspace_slug: string | null;
  status: string;
  last_indexed_at: string;
  last_index_hash: string | null;
  node_count: number;
  edge_count: number;
  trace_count: number;
  error_count: number;
}

// ─── Frontend-specific types ─────────────────────────────────

export type TraceStatus = 'ok' | 'error' | 'timeout' | 'partial';
export type ProjectStatusEnum = 'active' | 'archived' | 'importing' | 'error';
export type AISessionType =
  | 'explain_flow'
  | 'why_broke'
  | 'fix_it'
  | 'general'
  | 'security_scan'
  | 'translate';

/** Backend code_nodes row */
export interface CodeNode {
  id: string;
  project_id: string;
  oir_id: string;
  type: OIRNodeType;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  doc_comment: string | null;
  metadata: Record<string, unknown> | null;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

/** Backend code_edges row */
export interface CodeEdge {
  id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  type: OIREdgeType;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Error heatmap entry from `get_error_heatmap` RPC */
export interface ErrorHeatmapEntry {
  code_node_id: string;
  error_count: number;
  unique_errors: number;
  last_error_at: string;
  severity: string;
  heat_level: string;
  top_error_message: string;
  top_error_type: string;
  // Optionally populated by join in richer heatmap queries
  node_name?: string;
  node_type?: OIRNodeType;
  file_path?: string;
}

/** Trace row from backend */
export interface Trace {
  id: string;
  project_id: string;
  trace_id: string;
  root_service: string | null;
  root_operation: string | null;
  http_method: string | null;
  http_url: string | null;
  http_status: number | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  status: TraceStatus;
  error_message: string | null;
  tags: Record<string, unknown>;
  created_at: string;
}

/** Span row from backend */
export interface Span {
  id: string;
  project_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  code_node_id: string | null;
  service_name: string | null;
  operation: string;
  kind: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  status: TraceStatus;
  error_message: string | null;
  error_stack: string | null;
  attributes: Record<string, unknown> | null;
  events: Record<string, unknown>[] | null;
  created_at: string;
}

/** Error snapshot row from backend */
export interface ErrorSnapshot {
  id: string;
  project_id: string;
  code_node_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  fingerprint: string;
  error_type: string | null;
  error_message: string;
  error_stack: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  code_node?: { id: string; name: string; type: OIRNodeType; file_path: string };
}
