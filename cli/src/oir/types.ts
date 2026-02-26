// ─── OIR Node Types ─── matches backend `oir_node_type` enum
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

// ─── OIR Edge Types ─── matches backend `oir_edge_type` enum
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

export const OIR_NODE_TYPES: readonly OIRNodeType[] = [
  'module', 'component', 'function', 'class', 'route', 'middleware',
  'database_query', 'event_emitter', 'event_listener', 'external_api',
  'variable', 'type_def',
] as const;

export const OIR_EDGE_TYPES: readonly OIREdgeType[] = [
  'calls', 'imports', 'extends', 'implements', 'renders', 'routes_to',
  'queries', 'emits_event', 'subscribes_to', 'redirects_to', 'uses', 'exports',
] as const;

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
  last_indexed_at: string | null;
  last_index_hash: string | null;
  node_count: number;
  edge_count: number;
  trace_count: number;
  error_count: number;
}
