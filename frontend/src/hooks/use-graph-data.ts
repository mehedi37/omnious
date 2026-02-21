'use client';

import { useEffect, useMemo } from 'react';
import {
  applyErrorHeatmap,
  codeEdgesToReactFlow,
  codeNodesToReactFlow,
} from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

/** Max nodes per page — must match backend listNodesSchema max */
const PAGE_SIZE = 500;

/**
 * Fetches graph nodes + edges from backend, transforms to React Flow format,
 * and pushes into the graph store. Paginates nodes in PAGE_SIZE batches.
 */
export function useGraphData() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const heatmapActive = useGraphStore((s) => s.heatmapActive);

  // ── Page 1 (always fetched) ──
  const page1 = trpc.graph.listNodes.useQuery(
    { projectId: currentProjectId ?? '', limit: PAGE_SIZE, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );

  // Determine how many additional pages are needed once page 1 resolves
  const total = page1.data?.total ?? 0;
  const extraPageCount = Math.max(0, Math.ceil((total - PAGE_SIZE) / PAGE_SIZE));

  // ── Pages 2-N (conditionally enabled) ──
  const page2 = trpc.graph.listNodes.useQuery(
    { projectId: currentProjectId ?? '', limit: PAGE_SIZE, offset: PAGE_SIZE },
    { enabled: !!currentProjectId && extraPageCount >= 1, staleTime: 30_000 },
  );
  const page3 = trpc.graph.listNodes.useQuery(
    { projectId: currentProjectId ?? '', limit: PAGE_SIZE, offset: PAGE_SIZE * 2 },
    { enabled: !!currentProjectId && extraPageCount >= 2, staleTime: 30_000 },
  );
  const page4 = trpc.graph.listNodes.useQuery(
    { projectId: currentProjectId ?? '', limit: PAGE_SIZE, offset: PAGE_SIZE * 3 },
    { enabled: !!currentProjectId && extraPageCount >= 3, staleTime: 30_000 },
  );

  // Merge all pages into one flat array
  const allNodes = useMemo(
    () => [
      ...(page1.data?.nodes ?? []),
      ...(page2.data?.nodes ?? []),
      ...(page3.data?.nodes ?? []),
      ...(page4.data?.nodes ?? []),
    ],
    [page1.data, page2.data, page3.data, page4.data],
  );

  const edgesQuery = trpc.graph.listEdges.useQuery(
    { projectId: currentProjectId ?? '', limit: 1000, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );

  const heatmapQuery = trpc.error.heatmap.useQuery(
    { projectId: currentProjectId ?? '' },
    { enabled: !!currentProjectId && heatmapActive, staleTime: 15_000 },
  );

  // Determine loading state across all active pages
  const activePageLoading =
    page1.isLoading ||
    (extraPageCount >= 1 && page2.isLoading) ||
    (extraPageCount >= 2 && page3.isLoading) ||
    (extraPageCount >= 3 && page4.isLoading);

  // Push nodes into store when all pages are loaded
  useEffect(() => {
    if (activePageLoading || allNodes.length === 0) return;

    let rfNodes = codeNodesToReactFlow(allNodes as any);

    if (heatmapActive && heatmapQuery.data) {
      rfNodes = applyErrorHeatmap(rfNodes, heatmapQuery.data as any);
    }

    useGraphStore.getState().setNodes(rfNodes);
  }, [allNodes, activePageLoading, heatmapActive, heatmapQuery.data]);

  // Push edges into store when data arrives
  useEffect(() => {
    if (!edgesQuery.data?.edges) return;
    const rfEdges = codeEdgesToReactFlow(edgesQuery.data.edges as any);
    useGraphStore.getState().setEdges(rfEdges);
  }, [edgesQuery.data]);

  return {
    isLoading: activePageLoading || edgesQuery.isLoading,
    isError: page1.isError || edgesQuery.isError,
    error: page1.error ?? edgesQuery.error,
    nodeCount: allNodes.length,
    edgeCount: edgesQuery.data?.edges?.length ?? 0,
    /** Raw code edges from the DB — used by trace replay to map spans to edges */
    rawEdges: (edgesQuery.data?.edges ?? []) as import('@/lib/oir/types').CodeEdge[],
  };
}
