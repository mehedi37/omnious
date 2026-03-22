'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { cancelScheduledGraphLayout, scheduleGraphLayout } from '@/lib/layout/schedule-layout';
import type { AIMessageAttachment } from '@/lib/stores/ai-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { toReactFlowEdges, toReactFlowNodes, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { trpc } from '@/trpc/client';

function toSafeAiErrorMessage(raw: string): string {
  if (/too_small|String must contain at least 3 character\(s\)/i.test(raw)) {
    return 'Please enter at least 3 characters before running an AI query.';
  }
  if (/AI is not configured|OLLAMA_|No API key available/i.test(raw)) {
    return 'AI runtime is not ready. Ensure Ollama is running and backend OLLAMA settings are correct.';
  }
  if (/OpenAI API error 401|Incorrect API key|Anthropic API error/i.test(raw)) {
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
  const searchParams = useSearchParams();
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const prevProjectIdRef = useRef(projectId);
  const lastQueryRef = useRef('');
  const moduleGroupsCount = useGraphStore((s) => s.moduleGroups.length);
  const shareNextSlice = useGraphStore((s) => s.shareNextSlice);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const activeDetailTab = useUIStore((s) => s.activeDetailTab);
  const aiGenId = searchParams.get('ai_gen');

  useEffect(() => cancelScheduledGraphLayout, []);

  // ── Overview graph (landing page) ──────────────────────────────────────

  const overviewQuery = trpc.ai.getOverview.useQuery(
    { projectId: projectId ?? '' },
    {
      enabled: !!projectId && !aiGenId,
      staleTime: 5 * 60_000,
      gcTime: 15 * 60_000,
    },
  );

  const savedSliceQuery = trpc.ai.getGraphSlice.useQuery(
    { projectId: projectId ?? '', viewId: aiGenId ?? '' },
    {
      enabled: !!projectId && !!aiGenId,
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  );

  useEffect(() => {
    if (!savedSliceQuery.data) return;

    const nodes = toReactFlowNodes(savedSliceQuery.data.nodes);
    const edges = toReactFlowEdges(savedSliceQuery.data.edges);

    useGraphStore.getState().setGraph(nodes, edges);
    useGraphStore.getState().setLatestSliceId(savedSliceQuery.data.viewId);
    if (savedSliceQuery.data.explanation) {
      useGraphStore
        .getState()
        .setQueryResult(savedSliceQuery.data.explanation, [
          'Loaded AI-generated graph slice from link',
        ]);
    }
    scheduleGraphLayout();
  }, [savedSliceQuery.data]);

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
      enabled:
        !!projectId &&
        !!overviewQuery.data &&
        moduleGroupsCount === 0 &&
        detailPanelOpen &&
        activeDetailTab === 'ai' &&
        !aiGenId,
      staleTime: 10 * 60_000,
      gcTime: 30 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const saveGraphSliceMutation = trpc.ai.saveGraphSlice.useMutation();
  const createSessionMutation = trpc.ai.createSession.useMutation();
  const appendMessageMutation = trpc.ai.appendMessage.useMutation();

  useEffect(() => {
    if (moduleGroupsQuery.data?.groups) {
      useGraphStore.getState().setModuleGroups(moduleGroupsQuery.data.groups);
    }
  }, [moduleGroupsQuery.data]);

  // ── Session persistence helper ─────────────────────────────────────────

  const persistGraphSession = useCallback(
    async (
      userContent: string,
      assistantContent: string,
      contextNodeIds?: string[],
      tokenUsage?: { promptTokens: number; completionTokens: number; model: string },
    ) => {
      if (!projectId) return;
      try {
        let sessionId = useAIStore.getState().activeSessionId;
        if (!sessionId) {
          const session = await createSessionMutation.mutateAsync({
            projectId,
            type: 'graph_query',
            contextNodeIds,
          });
          sessionId = session.id;
          useAIStore.getState().setActiveSession(sessionId, 'graph_query');
        }
        const now = new Date().toISOString();
        appendMessageMutation.mutate({
          sessionId,
          messages: [
            { role: 'user', content: userContent, timestamp: now },
            { role: 'assistant', content: assistantContent, timestamp: now },
          ],
          tokenUsage,
        });
      } catch {
        // Session persistence is best-effort
      }
    },
    [projectId, createSessionMutation, appendMessageMutation],
  );

  // ── AI graph query (free-form question) ────────────────────────────────

  const queryGraphMutation = trpc.ai.queryGraph.useMutation({
    onMutate: () => {
      useGraphStore.getState().setQueryActive(true);
      useAIStore.getState().setStreaming(true);
    },
    onSuccess: async (result) => {
      // Update graph with the focused subgraph
      const nodes = toReactFlowNodes(result.nodes);
      const edges = toReactFlowEdges(result.edges);

      useGraphStore.getState().setGraph(nodes, edges);
      useGraphStore.getState().setQueryResult(result.explanation, result.steps);

      const evidenceAttachments = result.nodes
        .filter((node) => node.source === 'seed')
        .slice(0, 6)
        .map((node) => ({
          kind: 'node' as const,
          id: node.id,
          label: node.name,
          subtype: node.type,
        }));

      let explanationWithLink = result.explanation;
      try {
        if (projectId) {
          const saved = await saveGraphSliceMutation.mutateAsync({
            projectId,
            nodeIds: result.nodes.map((node) => node.id),
            edgeIds: result.edges.map((edge) => edge.id),
            query: lastQueryRef.current || undefined,
            explanation: result.explanation,
            isShared: shareNextSlice,
          });

          if (saved.viewId && workspaceSlug && projectSlug) {
            useGraphStore.getState().setLatestSliceId(saved.viewId);
            explanationWithLink = `${result.explanation}\n\n[Open this graph slice](/dashboard/${workspaceSlug}/${projectSlug}/graph?ai_gen=${saved.viewId})`;
          }
        }
      } catch {
        // Saving slices is best-effort and should not block AI responses.
      }

      // Add AI response to the chat
      useAIStore.getState().addMessage({
        role: 'assistant',
        content: explanationWithLink,
        timestamp: new Date().toISOString(),
        attachments: evidenceAttachments.length > 0 ? evidenceAttachments : undefined,
      });
      useAIStore.getState().setStreaming(false);
      useAIStore.getState().setTokenUsage({
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        total: result.usage.promptTokens + result.usage.completionTokens,
      });

      // Persist session best-effort
      persistGraphSession(lastQueryRef.current, explanationWithLink, undefined, {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        model: result.usage.model ?? 'unknown',
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

  /** Shared validation + user message for both queryGraph and streamQuery */
  const prepareQuery = useCallback(
    (query: string, attachments?: AIMessageAttachment[]): string | null => {
      if (!projectId) return null;
      const trimmed = query.trim();
      if (trimmed.length < 3) {
        useAIStore.getState().addMessage({
          role: 'assistant',
          content: 'Please enter at least 3 characters before running an AI query.',
          timestamp: new Date().toISOString(),
        });
        return null;
      }
      useAIStore.getState().addMessage({
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
        attachments,
      });
      lastQueryRef.current = trimmed;
      return trimmed;
    },
    [projectId],
  );

  const queryGraph = useCallback(
    (
      query: string,
      contextNodeIds?: string[],
      apiKeyId?: string,
      modelPreference?: 'auto' | 'fast' | 'powerful',
      attachments?: AIMessageAttachment[],
    ) => {
      const trimmed = prepareQuery(query, attachments);
      if (!trimmed) return;

      queryGraphMutation.mutate({
        projectId: projectId!,
        query: trimmed,
        apiKeyId,
        contextNodeIds,
        attachments,
        modelPreference,
      });
    },
    [projectId, prepareQuery, queryGraphMutation],
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

  // ── Streaming AI graph query (primary path) ────────────────────────────

  const streamQuery = useCallback(
    async (
      query: string,
      contextNodeIds?: string[],
      apiKeyId?: string,
      modelPreference?: 'auto' | 'fast' | 'powerful',
      attachments?: AIMessageAttachment[],
    ) => {
      const trimmed = prepareQuery(query, attachments);
      if (!trimmed) return;

      useGraphStore.getState().setQueryActive(true);
      useAIStore.getState().setStreaming(true);

      // Types for the SSE done event payload
      type DoneNodes = Array<{
        id: string;
        oir_id: string;
        type: string;
        name: string;
        file_path: string;
        line_start: number | null;
        line_end: number | null;
        signature: string | null;
        doc_comment: string | null;
        metadata: Record<string, unknown> | null;
        source: 'seed' | 'traversal' | 'semantic';
        relevance?: number;
      }>;
      type DoneEdges = Array<{
        id: string;
        source_node_id: string;
        target_node_id: string;
        type: string;
        metadata: Record<string, unknown> | null;
      }>;

      let doneNodes: DoneNodes = [];
      let doneEdges: DoneEdges = [];

      try {
        const supabase = createBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
        const resp = await fetch(`${apiBase}/api/ai/stream-graph-query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId,
            query: trimmed,
            apiKeyId,
            contextNodeIds,
            attachments,
            modelPreference,
          }),
        });

        if (!resp.ok) {
          throw new Error(`Stream request failed: ${resp.status}`);
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            try {
              const event = JSON.parse(raw) as
                | { type: 'step'; text: string }
                | { type: 'delta'; text: string }
                | { type: 'done'; nodes: DoneNodes; edges: DoneEdges; steps: string[] }
                | { type: 'error'; message: string };

              if (event.type === 'delta') {
                useAIStore.getState().appendToLastMessage(event.text);
              } else if (event.type === 'done') {
                doneNodes = event.nodes;
                doneEdges = event.edges;
              } else if (event.type === 'error') {
                throw new Error(event.message);
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue; // skip malformed SSE lines
              throw parseErr;
            }
          }
        }

        // After stream ends — update graph
        const rfNodes = toReactFlowNodes(doneNodes);
        const rfEdges = toReactFlowEdges(doneEdges);
        useGraphStore.getState().setGraph(rfNodes, rfEdges);

        const explanation = useAIStore.getState().messages.at(-1)?.content ?? '';
        if (explanation) {
          useGraphStore.getState().setQueryResult(explanation, []);
        }

        useAIStore.getState().setStreaming(false);
        useGraphStore.getState().setQueryActive(false);

        // Best-effort: save slice and add link to the message
        if (doneNodes.length > 0 && workspaceSlug && projectSlug) {
          saveGraphSliceMutation
            .mutateAsync({
              projectId: projectId!,
              nodeIds: doneNodes.map((n) => n.id),
              edgeIds: doneEdges.map((e) => e.id),
              query: lastQueryRef.current || undefined,
              explanation,
              isShared: shareNextSlice,
            })
            .then((saved) => {
              if (saved.viewId) {
                useGraphStore.getState().setLatestSliceId(saved.viewId);
                const link = `\n\n[Open this graph slice](/dashboard/${workspaceSlug}/${projectSlug}/graph?ai_gen=${saved.viewId})`;
                useAIStore.getState().appendToLastMessage(link);
              }
            })
            .catch(() => {
              /* best-effort */
            });
        }

        scheduleGraphLayout();

        // Persist graph session best-effort
        persistGraphSession(lastQueryRef.current, explanation);
      } catch (err) {
        useGraphStore.getState().setQueryActive(false);
        useAIStore.getState().setStreaming(false);
        useAIStore.getState().addMessage({
          role: 'assistant',
          content: toSafeAiErrorMessage(err instanceof Error ? err.message : String(err)),
          timestamp: new Date().toISOString(),
        });
      }
    },
    [
      projectId,
      workspaceSlug,
      projectSlug,
      prepareQuery,
      saveGraphSliceMutation,
      shareNextSlice,
      persistGraphSession,
    ],
  );

  return {
    // State
    isLoading: overviewQuery.isLoading || savedSliceQuery.isLoading,
    isQuerying: queryGraphMutation.isPending,
    isError: overviewQuery.isError,
    error: overviewQuery.error,

    // Actions
    queryGraph,
    streamQuery,
    showErrors,
    loadOverview,
  };
}
