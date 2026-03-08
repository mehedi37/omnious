// ─────────────────────────────────────────────────────────────
// Re-export OIR types from the shared package.
// CLI consumers should continue importing from this file.
// ─────────────────────────────────────────────────────────────

export {
  OIR_NODE_TYPES,
  OIR_EDGE_TYPES,
  type OIRNodeType,
  type OIREdgeType,
  type OIRNode,
  type OIREdge,
  type ParseResult,
  type ParseError,
  type OIRIndex,
  type IndexSummary,
  type PushResult,
  type ProjectStatus,
} from '@omnious/shared/oir-types';
