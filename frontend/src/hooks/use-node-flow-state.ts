'use client';

import { useGraphStore, type NodeFlowState } from '@/lib/stores/graph-store';
import type { FlowStep } from '@/lib/oir/trace-flow';

/**
 * Hook that returns the current flow animation state for a given node.
 * Used by all graph node components to apply visual states during trace replay.
 */
export function useNodeFlowState(nodeId: string): {
  flowState: NodeFlowState;
  isReplaying: boolean;
  activeStep: FlowStep | null;
  depth: number | null;
} {
  const flowMode = useGraphStore((s) => s.flowMode);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const activeFlowStep = useGraphStore((s) => s.activeFlowStep);
  const isCompleted = useGraphStore((s) => s.completedNodeIds.has(nodeId));
  const isError = useGraphStore((s) => s.errorNodeIds.has(nodeId));

  const isReplaying = flowMode === 'replay';

  if (!isReplaying) {
    return { flowState: 'idle', isReplaying: false, activeStep: null, depth: null };
  }

  const isActive = activeNodeId === nodeId;

  let flowState: NodeFlowState = 'idle';
  if (isActive) flowState = 'active';
  else if (isError) flowState = 'error';
  else if (isCompleted) flowState = 'completed';

  return {
    flowState,
    isReplaying,
    activeStep: isActive ? activeFlowStep : null,
    depth: isActive ? (activeFlowStep?.depth ?? null) : null,
  };
}

/**
 * Returns Tailwind class strings for the node's current flow state.
 * Designed to be merged with existing node classes.
 */
export function getFlowStateClasses(flowState: NodeFlowState, isReplaying: boolean): string {
  if (!isReplaying) return '';

  switch (flowState) {
    case 'active':
      return 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-background shadow-lg shadow-cyan-500/25 scale-105';
    case 'completed':
      return 'opacity-60';
    case 'error':
      return 'ring-2 ring-red-500 ring-offset-2 ring-offset-background shadow-lg shadow-red-500/25';
    case 'idle':
    default:
      return 'opacity-30 grayscale';
  }
}
