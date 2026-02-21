'use client';

import { useEffect } from 'react';
import { applyErrorHeatmap } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

/**
 * Fetches error heatmap data and applies it to graph nodes
 * whenever the heatmap toggle is active.
 */
export function useErrorHeatmap() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const heatmapActive = useGraphStore((s) => s.heatmapActive);

  const heatmapQuery = trpc.error.heatmap.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId && heatmapActive, staleTime: 15_000 },
  );

  // Apply heatmap overlay to existing nodes
  useEffect(() => {
    if (!heatmapActive || !heatmapQuery.data) return;

    const currentNodes = useGraphStore.getState().nodes;
    const updatedNodes = applyErrorHeatmap(currentNodes, heatmapQuery.data as any);
    useGraphStore.getState().setNodes(updatedNodes);
  }, [heatmapActive, heatmapQuery.data]);

  // Clear error data from nodes when heatmap is deactivated
  useEffect(() => {
    if (heatmapActive) return;

    const currentNodes = useGraphStore.getState().nodes;
    const cleaned = currentNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        errorCount: undefined,
        errorSeverity: undefined,
      },
    }));
    useGraphStore.getState().setNodes(cleaned);
  }, [heatmapActive]);

  return {
    isLoading: heatmapQuery.isLoading,
    errorCount: heatmapQuery.data?.length ?? 0,
  };
}
