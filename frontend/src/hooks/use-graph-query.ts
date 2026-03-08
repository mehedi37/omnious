'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore, toReactFlowNodes, toReactFlowEdges } from '@/lib/stores/graph-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

/**
 * Primary data hook for the AI-driven graph page.
 * Replaces `useGraphData` (which loaded ALL nodes via pagination).
 *
 * On mount: fetches overview graph (modules/packages/routes — ~20-50 nodes).
 * On AI query: calls `ai.queryGraph` → receives focused subgraph + explanation.
 * Also supports error/trace/dependency subgraph queries.
 */
export function useGraphQuery() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const hasLoadedOverview = useRef(false);

  // ── Overview graph (landing page) ──────────────────────────────────────

  const overviewQuery = trpc.ai.getOverview.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId,
      staleTime: 5 * 60_000,
      gcTime: 15 * 60_000,
    },
  );

  // Push overview data into the graph store on first load
  useEffect(() => {
    if (!overviewQuery.data || hasLoadedOverview.current) return;
    hasLoadedOverview.current = true;

    const nodes = toReactFlowNodes(overviewQuery.data.nodes);
    const edges = toReactFlowEdges(overviewQuery.data.edges);

    useGraphStore.getState().setGraph(nodes, edges);

    // Trigger layout after a short delay
    setTimeout(() => useGraphStore.getState().requestLayout(), 50);
  }, [overviewQuery.data]);

  // Reset when project changes
  useEffect(() => {
    hasLoadedOverview.current = false;
    useGraphStore.getState().clearGraph();
    useGraphStore.getState().clearModuleGroups();
  }, [projectId]);

  // ── Module groups (background fetch after overview loads) ──────────────

  const moduleGroupsQuery = trpc.graph.getModuleGroups.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId && hasLoadedOverview.current,
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
    },
  );

  useEffect(() => {
    if (moduleGroupsQuery.data?.groups) {
      useGraphStore.getState().setModuleGroups(moduleGroupsQuery.data.groups);
    }
  }, [moduleGroupsQuery.data]);

  // ── AI graph query (free-form question) ────────────────────────────────

  const queryGraphMutation = trpc.ai.queryGraph.useMutation({
    onMutate: () => {
      useGraphStore.getState().setQueryActive(true);
      useAIStore.getState().setStreaming(true);
    },
    onSuccess: (result) => {
      // Update graph with the focused subgraph
      const nodes = toReactFlowNodes(result.nodes);
      const edges = toReactFlowEdges(result.edges);

      useGraphStore.getState().setGraph(nodes, edges);
      useGraphStore.getState().setQueryResult(result.explanation, result.steps);

      // Add AI response to the chat
      useAIStore.getState().addMessage({
        role: 'assistant',
        content: result.explanation,
        timestamp: new Date().toISOString(),
      });
      useAIStore.getState().setStreaming(false);
      useAIStore.getState().setTokenUsage({
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.promptTokens + result.usage.completionTokens,
      });

      // Trigger layout
      setTimeout(() => useGraphStore.getState().requestLayout(), 50);
    },
    onError: (error) => {
      useGraphStore.getState().setQueryActive(false);
      useAIStore.getState().setStreaming(false);
      useAIStore.getState().addMessage({
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    },
  });

  const queryGraph = useCallback(
    (query: string, contextNodeIds?: string[], apiKeyId?: string, modelPreference?: 'auto' | 'fast' | 'powerful') => {
      if (!projectId) return;

      // Add user message to chat
      useAIStore.getState().addMessage({
        role: 'user',
        content: query,
        timestamp: new Date().toISOString(),
      });

      queryGraphMutation.mutate({
        projectId,
        query,
        apiKeyId,
        contextNodeIds,
        modelPreference,
      });
    },
    [projectId, queryGraphMutation],
  );

  // ── Error subgraph query ───────────────────────────────────────────────

  const queryErrorsMutation = trpc.ai.queryErrors.useQuery(
    { projectId: projectId ?? '' },
    { enabled: false }, // Manual trigger only
  );

  const showErrors = useCallback(() => {
    if (!projectId) return;
    queryErrorsMutation.refetch().then(({ data }) => {
      if (!data) return;
      const nodes = toReactFlowNodes(data.nodes);
      const edges = toReactFlowEdges(data.edges);
      useGraphStore.getState().setGraph(nodes, edges);
      setTimeout(() => useGraphStore.getState().requestLayout(), 50);
    });
  }, [projectId, queryErrorsMutation]);

  // ── Load overview (reset to landing state) ─────────────────────────────

  const loadOverview = useCallback(() => {
    if (!overviewQuery.data) return;
    const nodes = toReactFlowNodes(overviewQuery.data.nodes);
    const edges = toReactFlowEdges(overviewQuery.data.edges);
    useGraphStore.getState().setGraph(nodes, edges);
    useGraphStore.getState().clearQueryResult();
    useAIStore.getState().clearSession();
    setTimeout(() => useGraphStore.getState().requestLayout(), 50);
  }, [overviewQuery.data]);

  return {
    // State
    isLoading: overviewQuery.isLoading,
    isQuerying: queryGraphMutation.isPending,
    isError: overviewQuery.isError,
    error: overviewQuery.error,

    // Actions
    queryGraph,
    showErrors,
    loadOverview,
  };
}
