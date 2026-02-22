import type { NodeTypes } from '@xyflow/react';
import { CodeNode } from './code-node';
import { GroupNode } from './group-node';

/**
 * Module-level node types constant — MUST be defined outside any component.
 * If defined inside a component, React Flow will unmount/remount all nodes
 * on every render, destroying performance.
 */
export const nodeTypes: NodeTypes = {
  code: CodeNode,
  group: GroupNode,
};
