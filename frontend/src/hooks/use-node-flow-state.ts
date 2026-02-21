'use client';

import { useShallow } from 'zustand/react/shallow';
import type { FlowStep } from '@/lib/oir/trace-flow';
import { type NodeFlowState, useGraphStore } from '@/lib/stores/graph-store';

/** Derived state returned to each node component */
interface NodeFlowResult {
  flowState: NodeFlowState;
  isReplaying: boolean;
  activeStep: FlowStep | null;
  depth: number | null;
  isFocusDimmed: boolean;
}

/**
 * Hook that returns the current flow animation state for a given node.
 * Uses a SINGLE combined selector to minimise Zustand subscription count.
 * With 665 nodes, each having 7 individual selectors = 4,655 subscriptions.
 * This reduces it to 1 selector per node = 665 subscriptions.
 */
export function useNodeFlowState(nodeId: string): NodeFlowResult {
  return useGraphStore(
    useShallow((s) => {
      // NOTE: useShallow is required — this selector returns a plain object.
      // Without it, Zustand uses Object.is() which always sees a new reference,
      // causing infinite re-renders (React error #185).
      const isReplaying = s.flowMode === 'replay';
      const isFocusDimmed = s.focusedNodeId !== null && !s.connectedNodeIds.has(nodeId);

      if (!isReplaying) {
        return {
          flowState: 'idle' as const,
          isReplaying: false,
          activeStep: null,
          depth: null,
          isFocusDimmed,
        };
      }

      const isActive = s.activeNodeId === nodeId;
      let flowState: NodeFlowState = 'idle';
      if (isActive) flowState = 'active';
      else if (s.errorNodeIds.has(nodeId)) flowState = 'error';
      else if (s.completedNodeIds.has(nodeId)) flowState = 'completed';

      return {
        flowState,
        isReplaying: true,
        activeStep: isActive ? s.activeFlowStep : null,
        depth: isActive ? (s.activeFlowStep?.depth ?? null) : null,
        isFocusDimmed,
      };
    }),
  );
}

/**
 * Returns Tailwind class strings for the node's current flow state.
 * Designed to be merged with existing node classes.
 */
export function getFlowStateClasses(
  flowState: NodeFlowState,
  isReplaying: boolean,
  isFocusDimmed = false,
): string {
  if (isFocusDimmed && !isReplaying) {
    return 'opacity-[0.12] grayscale pointer-events-none transition-all duration-300';
  }
  if (!isReplaying) return '';

  switch (flowState) {
    case 'active':
      return 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-background shadow-lg shadow-cyan-500/25 scale-105';
    case 'completed':
      return 'opacity-60';
    case 'error':
      return 'ring-2 ring-red-500 ring-offset-2 ring-offset-background shadow-lg shadow-red-500/25';
    default:
      return 'opacity-30 grayscale';
  }
}
