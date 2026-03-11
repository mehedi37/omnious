'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import { EmptyProjectState } from '@/components/project/empty-project-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ReactFlowCanvas } from '@/components/graph/react-flow-canvas';
import { GraphFilterToolbar } from '@/components/graph/graph-filter-toolbar';
import { UnifiedAIPanel } from '@/components/ai/unified-ai-panel';
import { NodeDetailPanel } from '@/components/graph/panels/node-detail-panel';
import { useGraphQuery } from '@/hooks/use-graph-query';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useErrorHeatmap } from '@/hooks/use-error-heatmap';
import { useElkLayout } from '@/hooks/use-elk-layout';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

function GraphPageContent() {
  // Fetch project & node count — gates the entire graph render
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const projectQuery = trpc.project.getById.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  );

  const nodeCountQuery = trpc.graph.listNodes.useQuery(
    { projectId: projectId ?? '', limit: 1, offset: 0 },
    { enabled: !!projectId, staleTime: 30_000 },
  );

  const isLoading =
    !projectId ||
    nodeCountQuery.isLoading ||
    projectQuery.isLoading;

  const hasNodes = (nodeCountQuery.data?.total ?? 0) > 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-16 w-16 rounded-full mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
          <Skeleton className="h-3 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  // Empty state (no nodes indexed yet)
  if (!hasNodes) {
    return (
      <div className="h-full overflow-auto">
        <EmptyProjectState
          projectName={projectQuery.data?.name ?? projectSlug ?? 'Project'}
          projectSlug={projectSlug ?? ''}
          apiKey={projectQuery.data?.api_key ?? null}
          workspaceSlug={workspaceSlug ?? ''}
        />
      </div>
    );
  }

  // Graph is ready — render all hooks unconditionally below this point
  return <GraphPageInner />;
}

function GraphPageInner() {
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const panelOpen = useAIStore((s) => s.panelOpen);

  // Wire up all keyboard shortcuts
  useKeyboardShortcuts();

  // Wire up error heatmap data fetch
  useErrorHeatmap();

  // Connect ELK layout worker to graph store
  useElkLayout();

  // AI-driven data hook — loads overview on mount, supports AI queries
  const { isLoading: isDataLoading, isQuerying, queryGraph, showErrors, loadOverview } =
    useGraphQuery();

  // Handle expand-deps event from context menu
  useEffect(() => {
    function handleExpandDeps(e: Event) {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      if (!nodeId) return;
      queryGraph(`Show me the dependencies of node ${nodeId}`, [nodeId]);
      useAIStore.getState().openPanel();
    }
    window.addEventListener('omnious:expand-deps', handleExpandDeps);
    return () => window.removeEventListener('omnious:expand-deps', handleExpandDeps);
  }, [queryGraph]);

  // Pick up focus-node from sessionStorage (coming from error list "Focus on Graph")
  useEffect(() => {
    const focusNodeId = sessionStorage.getItem('omnious:focus-node');
    if (focusNodeId) {
      sessionStorage.removeItem('omnious:focus-node');
      const timer = setTimeout(() => {
        useGraphStore.getState().selectNode(focusNodeId);
        useGraphStore.getState().setFocusMode(focusNodeId);
        useGraphStore.getState().highlightConnectedEdges(focusNodeId);
        useUIStore.getState().setDetailPanelOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="flex h-full">
      {/* Main canvas area */}
      <div className="relative flex-1 min-w-0 flex flex-col">
        <GraphFilterToolbar />
        <div className="relative flex-1 min-w-0">
          <ReactFlowCanvas />

          {/* AI panel open button — shown when panel is closed */}
          {!panelOpen && (
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2 z-10 gap-1.5 shadow-md"
              onClick={() => useAIStore.getState().openPanel()}
              title="Open AI Explorer (Ctrl+Shift+A)"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs">AI</span>
            </Button>
          )}
        </div>

        {/* Loading overlay */}
        {isDataLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="space-y-4 text-center">
              <Skeleton className="h-16 w-16 rounded-full mx-auto" />
              <Skeleton className="h-4 w-48 mx-auto" />
              <Skeleton className="h-3 w-32 mx-auto" />
            </div>
          </div>
        )}
      </div>

      {/* AI Panel — Sheet from right */}
      <Sheet
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) useAIStore.getState().closePanel();
        }}
        modal={false}
      >
        <SheetContent
          side="right"
          className="w-full sm:w-95 md:w-105 p-0 border-l"
          showCloseButton={false}
        >
          <UnifiedAIPanel
            mode="graph"
            onQuery={queryGraph}
            onShowErrors={showErrors}
            onLoadOverview={loadOverview}
            isQuerying={isQuerying}
            onClose={() => useAIStore.getState().closePanel()}
          />
        </SheetContent>
      </Sheet>

      {/* Node detail sheet (slides from right) */}
      <Sheet
        open={detailPanelOpen}
        onOpenChange={(open) => {
          if (!open) useUIStore.getState().setDetailPanelOpen(false);
        }}
        modal={false}
      >
        <SheetContent
          side="right"
          className="w-full sm:w-95 md:w-105 p-0 border-l"
          showCloseButton={false}
        >
          <NodeDetailPanel />
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <div className="space-y-4 text-center">
            <Skeleton className="h-16 w-16 rounded-full mx-auto" />
            <Skeleton className="h-4 w-48 mx-auto" />
            <Skeleton className="h-3 w-32 mx-auto" />
          </div>
        </div>
      }
    >
      <ReactFlowProvider>
        <GraphPageContent />
      </ReactFlowProvider>
    </Suspense>
  );
}
