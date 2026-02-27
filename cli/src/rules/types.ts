import type { OIRNode, OIREdge } from '../oir/types.js';

/** Severity levels matching standard diagnostic conventions */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/** A diagnostic produced by a static analysis rule */
export interface Diagnostic {
  /** Rule that produced this diagnostic (e.g. "circular-deps") */
  rule_id: string;
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Human-readable message */
  message: string;
  /** OIR ID of the affected node (if applicable) */
  code_node_oir_id: string | null;
  /** File path relative to project root */
  file_path: string;
  /** Start line (1-based) */
  line_start: number | null;
  /** End line (1-based) */
  line_end: number | null;
  /** Extra structured data */
  metadata: Record<string, unknown>;
}

/** Context passed to each rule */
export interface RuleContext {
  nodes: OIRNode[];
  edges: OIREdge[];
  /** Map from oir_id → OIRNode for fast lookup */
  nodeMap: Map<string, OIRNode>;
  /** Adjacency list: source_oir_id → target_oir_ids */
  outgoing: Map<string, Set<string>>;
  /** Reverse adjacency: target_oir_id → source_oir_ids */
  incoming: Map<string, Set<string>>;
  /** Full edges grouped by source */
  outgoingEdges: Map<string, OIREdge[]>;
}

/** Per-rule threshold overrides from .omnious.yml */
export interface RulesConfig {
  'large-functions'?: {
    max_lines?: number;
    max_params?: number;
  };
  'hub-nodes'?: {
    max_fan_in?: number;
    max_fan_out?: number;
  };
  /** Disable specific rules */
  disabled?: string[];
}

/** A static analysis rule */
export interface Rule {
  /** Unique rule ID (should be kebab-case) */
  id: string;
  /** Short description of the rule */
  description: string;
  /** Default severity */
  severity: DiagnosticSeverity;
  /** Run the rule against the graph and return diagnostics */
  run(ctx: RuleContext, config?: RulesConfig): Diagnostic[];
}
