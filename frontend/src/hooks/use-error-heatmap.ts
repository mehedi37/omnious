'use client';

import { useEffect } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

/**
 * Fetches error heatmap data when heatmapActive changes to true.
 * Merges errorCount + errorSeverity into graph store nodes so the
 * omnious-node heatmap glows and severity filter chips work correctly.
 *
 * Must be mounted inside a component that has access to the tRPC context
 * (i.e., inside the TRPCReactProvider).
 */
export function useErrorHeatmap() {
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  const heatmapQuery = trpc.error.heatmap.useQuery(
    { projectId: projectId ?? '', since: '7 days' },
    {
      enabled: false, // manual trigger only
      staleTime: 60_000,
    },
  );

  // Fetch and apply heatmap data when toggled on
  useEffect(() => {
    if (!heatmapActive || !projectId) return;

    heatmapQuery.refetch().then(({ data }) => {
      if (!data) return;
      useGraphStore.getState().applyHeatmapData(
        data as Array<{
          code_node_id: string;
          error_count: number;
          severity: string;
          heat_level: string;
        }>,
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapActive, projectId]);

  // Clear merged error data when heatmap is turned off
  useEffect(() => {
    if (!heatmapActive) {
      useGraphStore.getState().clearHeatmapData();
    }
  }, [heatmapActive]);
}
