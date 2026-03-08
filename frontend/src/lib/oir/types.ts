// ─────────────────────────────────────────────────────────────
// Re-export OIR types from the shared package.
// Frontend consumers should continue importing from this file.
// ─────────────────────────────────────────────────────────────

export type {
  OIRNodeType,
  OIREdgeType,
  TraceStatus,
  ProjectStatusEnum as ProjectStatus,
  AISessionType,
  CodeNode,
  CodeEdge,
  ErrorHeatmapEntry,
  Trace,
  Span,
  ErrorSnapshot,
} from '@omnious/shared/oir-types';
