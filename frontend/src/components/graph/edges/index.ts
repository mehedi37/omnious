import { DataFlowEdge } from './data-flow-edge';
import { DependencyEdge } from './dependency-edge';
import { RuntimeEdge } from './runtime-edge';

/**
 * Module-level edgeTypes constant — MUST be defined outside component
 * to prevent React Flow from re-registering on every render.
 */
export const edgeTypes = {
  dataFlow: DataFlowEdge,
  dependency: DependencyEdge,
  runtime: RuntimeEdge,
} as const;
