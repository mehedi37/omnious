import type { EdgeTypes } from '@xyflow/react';
import { AnimatedEdge } from './animated-edge';
import { RoutedEdge } from './routed-edge';

/**
 * Module-level edge types constant — MUST be defined outside any component.
 */
export const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
  routed: RoutedEdge,
};
