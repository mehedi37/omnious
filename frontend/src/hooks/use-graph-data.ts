'use client';

import { useEffect } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { codeNodesToReactFlow, codeEdgesToReactFlow, applyErrorHeatmap } from '@/lib/oir/transforms';

/**
 * Fetches graph nodes + edges from backend, transforms to React Flow format,
 * and pushes into the graph store. Also fetches error heatmap when active.
 */
export function useGraphData() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const heatmapActive = useGraphStore((s) => s.heatmapActive);

  const nodesQuery = trpc.graph.listNodes.useQuery(
    { projectId: currentProjectId ?? '', limit: 2000, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );

  const edgesQuery = trpc.graph.listEdges.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );

  const heatmapQuery = trpc.error.heatmap.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId && heatmapActive, staleTime: 15_000 },
  );

  // Push nodes into store when data arrives
  useEffect(() => {
    if (!nodesQuery.data?.nodes) return;

    let rfNodes = codeNodesToReactFlow(nodesQuery.data.nodes as any);

    // Apply error heatmap overlay if active
    if (heatmapActive && heatmapQuery.data) {
      rfNodes = applyErrorHeatmap(rfNodes, heatmapQuery.data as any);
    }

    useGraphStore.getState().setNodes(rfNodes);
  }, [nodesQuery.data, heatmapActive, heatmapQuery.data]);

  // Push edges into store when data arrives
  useEffect(() => {
    if (!edgesQuery.data?.edges) return;
    const rfEdges = codeEdgesToReactFlow(edgesQuery.data.edges as any);
    useGraphStore.getState().setEdges(rfEdges);
  }, [edgesQuery.data]);

  return {
    isLoading: nodesQuery.isLoading || edgesQuery.isLoading,
    isError: nodesQuery.isError || edgesQuery.isError,
    error: nodesQuery.error ?? edgesQuery.error,
    nodeCount: nodesQuery.data?.nodes?.length ?? 0,
    edgeCount: edgesQuery.data?.edges?.length ?? 0,
    /** Raw code edges from the DB — used by trace replay to map spans to edges */
    rawEdges: (edgesQuery.data?.edges ?? []) as import('@/lib/oir/types').CodeEdge[],
  };
}
