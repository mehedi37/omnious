// ─────────────────────────────────────────────────────────────
// OIR Zod Schemas — derived from the shared const arrays
// ─────────────────────────────────────────────────────────────
// These schemas are used by the backend (tRPC routers) and CLI
// for runtime validation. The frontend generally only needs the
// TypeScript types from oir-types.ts.
// ─────────────────────────────────────────────────────────────

import { z } from 'zod';
import { OIR_NODE_TYPES, OIR_EDGE_TYPES } from './oir-types.js';
import type { OIRNodeType, OIREdgeType } from './oir-types.js';

// Cast to mutable tuple preserving literal types so z.enum() infers correctly
type NodeTuple = [OIRNodeType, ...OIRNodeType[]];
type EdgeTuple = [OIREdgeType, ...OIREdgeType[]];

/** Zod schema for `oir_node_type` — validates against the shared const array */
export const oirNodeTypeSchema = z.enum(OIR_NODE_TYPES as unknown as NodeTuple);

/** Zod schema for `oir_edge_type` — validates against the shared const array */
export const oirEdgeTypeSchema = z.enum(OIR_EDGE_TYPES as unknown as EdgeTuple);

/** Zod schema for a single OIR node (used in push/upsert endpoints) */
export const oirNodeSchema = z.object({
  oir_id: z.string(),
  type: oirNodeTypeSchema,
  name: z.string(),
  file_path: z.string(),
  line_start: z.number().int().nullable().optional(),
  line_end: z.number().int().nullable().optional(),
  signature: z.string().nullable().optional(),
  doc_comment: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  content_hash: z.string(),
  code_body: z.string().nullable().optional(),
});

/** Zod schema for a single OIR edge (used in upsert endpoints) */
export const oirEdgeSchema = z.object({
  source_node_id: z.string().uuid(),
  target_node_id: z.string().uuid(),
  type: oirEdgeTypeSchema,
  metadata: z.record(z.unknown()).optional(),
});

/** Zod schema for an OIR edge referenced by oir_id (used in CLI push) */
export const oirEdgeByOirIdSchema = z.object({
  source_oir_id: z.string(),
  target_oir_id: z.string(),
  type: oirEdgeTypeSchema,
  metadata: z.record(z.unknown()).optional(),
});
