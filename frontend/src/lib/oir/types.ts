/** OIR Node type — matches backend `oir_node_type` enum */
export type OIRNodeType =
  | 'module'
  | 'component'
  | 'function'
  | 'class'
  | 'route'
  | 'middleware'
  | 'database_query'
  | 'event_emitter'
  | 'event_listener'
  | 'external_api'
  | 'variable'
  | 'type_def';

/** OIR Edge type — matches backend `oir_edge_type` enum */
export type OIREdgeType =
  | 'calls'
  | 'imports'
  | 'extends'
  | 'implements'
  | 'renders'
  | 'routes_to'
  | 'queries'
  | 'emits_event'
  | 'subscribes_to'
  | 'redirects_to'
  | 'uses'
  | 'exports';

export type TraceStatus = 'ok' | 'error' | 'timeout' | 'partial';
export type ProjectStatus = 'active' | 'archived' | 'importing' | 'error';
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
  node_name: string;
  node_type: OIRNodeType;
  file_path: string;
  error_count: number;
  unique_errors: number;
  last_error_at: string;
  severity: string;
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
