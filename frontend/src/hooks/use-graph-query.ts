'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore, toReactFlowNodes, toReactFlowEdges } from '@/lib/stores/graph-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cancelScheduledGraphLayout, scheduleGraphLayout } from '@/lib/layout/schedule-layout';
import { trpc } from '@/trpc/client';

function toSafeAiErrorMessage(raw: string): string {
  if (/too_small|String must contain at least 3 character\(s\)/i.test(raw)) {
    return 'Please enter at least 3 characters before running an AI query.';
  }
  if (/AI is not configured|OLLAMA_|No API key available/i.test(raw)) {
    return 'AI runtime is not ready. Ensure Ollama is running and backend OLLAMA settings are correct.';
  }
  if (/OpenAI API error 401|Incorrect API key|Anthropic API error|Groq API error/i.test(raw)) {
    return 'AI provider authentication failed. Local Ollama mode should not require a paid provider key.';
  }
  return 'AI query failed. Please try again.';
}

/**
 * Primary data hook for the AI-driven graph page.
 *
 * On mount: fetches overview graph (modules/packages/routes — ~20-50 nodes).
 * On AI query: calls `ai.queryGraph` → receives focused subgraph + explanation.
 * Also supports error/trace/dependency subgraph queries.
 */
export function useGraphQuery() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const prevProjectIdRef = useRef(projectId);
  const moduleGroupsCount = useGraphStore((s) => s.moduleGroups.length);

  useEffect(() => cancelScheduledGraphLayout, []);

  // ── Overview graph (landing page) ──────────────────────────────────────

  const overviewQuery = trpc.ai.getOverview.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId,
      staleTime: 5 * 60_000,
      gcTime: 15 * 60_000,
    },
  );

  // Clear graph store when project changes (skip on initial mount)
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      useGraphStore.getState().clearGraph();
      useGraphStore.getState().clearModuleGroups();
    }
  }, [projectId]);

  // Sync overview data into the graph store whenever it arrives (or on remount with cached data)
  useEffect(() => {
    if (!overviewQuery.data) return;

    const nodes = toReactFlowNodes(overviewQuery.data.nodes);
    const edges = toReactFlowEdges(overviewQuery.data.edges);

    useGraphStore.getState().setGraph(nodes, edges);
    scheduleGraphLayout();
  }, [overviewQuery.data]);

  // ── Module groups (background fetch after overview loads) ──────────────

  const moduleGroupsQuery = trpc.graph.getModuleGroups.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId && !!overviewQuery.data && moduleGroupsCount === 0,
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
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
      scheduleGraphLayout();
    },
    onError: (error) => {
      useGraphStore.getState().setQueryActive(false);
      useAIStore.getState().setStreaming(false);
      useAIStore.getState().addMessage({
        role: 'assistant',
        content: toSafeAiErrorMessage(error.message),
        timestamp: new Date().toISOString(),
      });
    },
  });

  const queryGraph = useCallback(
    (query: string, contextNodeIds?: string[], apiKeyId?: string, modelPreference?: 'auto' | 'fast' | 'powerful') => {
      if (!projectId) return;
      const trimmed = query.trim();
      if (trimmed.length < 3) {
        useAIStore.getState().addMessage({
          role: 'assistant',
          content: 'Please enter at least 3 characters before running an AI query.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Add user message to chat
      useAIStore.getState().addMessage({
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      });

      queryGraphMutation.mutate({
        projectId,
        query: trimmed,
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
      scheduleGraphLayout();
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
    scheduleGraphLayout();
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
