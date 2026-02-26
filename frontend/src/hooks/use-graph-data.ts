'use client';

import { useEffect } from 'react';
import {
  applyErrorHeatmapToGraph,
  pushCodesToGraph,
} from '@/lib/oir/transforms';
import { getOrCreateGraph, useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

/** Max nodes per page — must match backend listNodesSchema max */
const PAGE_SIZE = 500;

/**
 * Fetches graph nodes + edges from backend, transforms to graphology format,
 * and pushes into the graphology graph + Zustand store. Paginates nodes in PAGE_SIZE batches.
 */
export function useGraphData() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const viewMode = useGraphStore((s) => s.viewMode);

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
  const allNodes = [
    ...(page1.data?.nodes ?? []),
    ...(page2.data?.nodes ?? []),
    ...(page3.data?.nodes ?? []),
    ...(page4.data?.nodes ?? []),
  ];

  const edgesQuery = trpc.graph.listEdges.useQuery(
    { projectId: currentProjectId ?? '', limit: 1000, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );

  // Page 2 for edges (when total > 1000)
  const edgesTotal = edgesQuery.data?.total ?? 0;
  const edgesPage2 = trpc.graph.listEdges.useQuery(
    { projectId: currentProjectId ?? '', limit: 1000, offset: 1000 },
    { enabled: !!currentProjectId && edgesTotal > 1000, staleTime: 30_000 },
  );

  const allEdges = [
    ...(edgesQuery.data?.edges ?? []),
    ...(edgesPage2.data?.edges ?? []),
  ];

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

  // Push nodes + edges into graphology when all pages are loaded
  useEffect(() => {
    if (activePageLoading || allNodes.length === 0) return;
    if (allEdges.length === 0 && edgesQuery.isLoading) return;

    const graph = getOrCreateGraph();
    const codeEdges = allEdges as import('@/lib/oir/types').CodeEdge[];
    const codeNodes = allNodes as import('@/lib/oir/types').CodeNode[];
    const currentViewMode = useGraphStore.getState().viewMode;

    pushCodesToGraph(codeNodes, codeEdges, graph, currentViewMode);

    // Apply heatmap if active
    if (heatmapActive && heatmapQuery.data) {
      applyErrorHeatmapToGraph(
        heatmapQuery.data as import('@/lib/oir/types').ErrorHeatmapEntry[],
        graph,
      );
    }

    useGraphStore.getState().bumpGraphVersion({
      nodeCount: graph.order,
      edgeCount: graph.size,
    });

    // Sync graphology → React Flow nodes/edges
    useGraphStore.getState().syncFromGraphology();

    // Request layout after data has been pushed
    setTimeout(() => useGraphStore.getState().requestLayout(), 50);
  }, [allNodes, activePageLoading, allEdges, edgesQuery.isLoading, heatmapActive, heatmapQuery.data]);

  // Re-apply heatmap when it is toggled on while data is already present
  useEffect(() => {
    if (!heatmapActive || !heatmapQuery.data) return;
    const graph = getOrCreateGraph();
    if (graph.order === 0) return;

    applyErrorHeatmapToGraph(
      heatmapQuery.data as import('@/lib/oir/types').ErrorHeatmapEntry[],
      graph,
    );
    // Trigger visual refresh via React Flow sync
    useGraphStore.getState().syncFromGraphology();
  }, [heatmapActive, heatmapQuery.data]);

  return {
    isLoading: activePageLoading || edgesQuery.isLoading,
    isError: page1.isError || edgesQuery.isError,
    error: page1.error ?? edgesQuery.error,
    nodeCount: allNodes.length,
    edgeCount: allEdges.length,
    edgesTotal,
    /** Raw code edges from the DB — used by trace replay to map spans to edges */
    rawEdges: allEdges as import('@/lib/oir/types').CodeEdge[],
  };
}
