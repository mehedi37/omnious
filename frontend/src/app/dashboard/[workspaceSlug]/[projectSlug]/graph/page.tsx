'use client';

import { FolderTree, PanelRight, Pause, Play, X } from 'lucide-react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AstTreeSidebar } from '@/components/graph/ast-tree-sidebar';
import { D3GraphCanvas } from '@/components/graph/d3/d3-graph-canvas';
import { GraphDiffPanel } from '@/components/graph/graph-diff-panel';
import { GraphMinimap } from '@/components/graph/graph-minimap';
import { GraphSearchPanel } from '@/components/graph/graph-search-panel';
import { GraphFilterToolbar } from '@/components/graph/graph-filter-toolbar';
import { InspectorPanel } from '@/components/graph/panels/inspector-panel';
import { EmptyProjectState } from '@/components/project/empty-project-state';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorHeatmap } from '@/hooks/use-error-heatmap';
import { useGraphQuery } from '@/hooks/use-graph-query';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useTracePlayback } from '@/hooks/use-trace-playback';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import type { Span } from '@/lib/oir/types';
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

  const isLoading = !projectId || nodeCountQuery.isLoading || projectQuery.isLoading;

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
  const isMobile = useIsMobile();
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [diffSheetOpen, setDiffSheetOpen] = useState(false);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const pendingReplayTraceId = useUIStore((s) => s.pendingReplayTraceId);
  const trpcUtils = trpc.useUtils();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Wire up all keyboard shortcuts
  useKeyboardShortcuts();

  // Wire up error heatmap data fetch
  useErrorHeatmap();

  // Subscribe to Realtime push events — auto-refresh graph when CLI pushes
  usePushNotifications();

  // Trace replay controls
  const { startReplay, exitReplay, isPlaying, togglePlay, currentStep, totalSteps } =
    useTracePlayback();

  // AI-driven data hook — loads overview on mount, supports AI queries
  const {
    isLoading: isDataLoading,
    isQuerying,
    streamQuery,
    showErrors,
    loadOverview,
  } = useGraphQuery();

  // Handle expand-deps event from context menu
  useEffect(() => {
    function handleExpandDeps(e: Event) {
      const { nodeId, nodeName } = (e as CustomEvent<{ nodeId: string; nodeName?: string }>).detail;
      if (!nodeId) return;
      const label = nodeName?.trim() || 'selected node';
      streamQuery(`Show me the dependencies of #${label}`, [nodeId], undefined, undefined, [
        { kind: 'node', id: nodeId, label },
      ]);
      useUIStore.getState().setActiveDetailTab('ai');
    }
    window.addEventListener('omnious:expand-deps', handleExpandDeps);
    return () => window.removeEventListener('omnious:expand-deps', handleExpandDeps);
  }, [streamQuery]);

  // Pick up focus-node from sessionStorage (coming from error list "Focus on Graph").
  // Poll until the node exists in the store — avoids race with simulation settling.
  useEffect(() => {
    const focusNodeId = sessionStorage.getItem('omnious:focus-node');
    if (!focusNodeId) return;
    sessionStorage.removeItem('omnious:focus-node');

    let timer: ReturnType<typeof setTimeout>;

    function tryFocus() {
      const nodes = useGraphStore.getState().nodes;
      if (nodes.length > 0 && nodes.some((n) => n.id === focusNodeId)) {
        useGraphStore.getState().selectNode(focusNodeId!);
        useGraphStore.getState().setFocusMode(focusNodeId!);
        useGraphStore.getState().highlightConnectedEdges(focusNodeId!);
        useUIStore.getState().setActiveDetailTab('details');
        // The canvas subscribes to focusedNodeId changes and pans automatically
      } else {
        // Graph not ready yet — retry
        timer = setTimeout(tryFocus, 200);
      }
    }

    // Give the engine an initial moment to mount before polling
    timer = setTimeout(tryFocus, 300);
    return () => clearTimeout(timer);
  }, []);

  // Consume pendingReplayTraceId — fetch spans and start the flow animation
  useEffect(() => {
    if (!pendingReplayTraceId || !currentProjectId) return;

    // Clear immediately so a re-render doesn't re-trigger
    useUIStore.getState().setPendingReplayTraceId(null);

    async function doReplay(traceId: string) {
      const result = await trpcUtils.trace.getById.fetch({
        projectId: currentProjectId!,
        traceId,
      });

      if (!result?.spans || result.spans.length === 0) return;

      // Convert OmniousEdge[] → CodeEdge-compatible for buildFlowSteps
      const staticEdges = useGraphStore.getState().edges.map((e) => ({
        id: e.id,
        project_id: currentProjectId!,
        source_node_id: e.source,
        target_node_id: e.target,
        type: (e.data?.edgeType ?? 'calls') as import('@/lib/oir/types').OIREdgeType,
        metadata: null,
        created_at: new Date().toISOString(),
      }));

      startReplay(traceId, result.spans as Span[], staticEdges);
    }

    doReplay(pendingReplayTraceId).catch(console.error);
  }, [pendingReplayTraceId, currentProjectId, trpcUtils, startReplay]);

  const inspectorProps = {
    onQuery: streamQuery,
    onShowErrors: showErrors,
    onLoadOverview: loadOverview,
    isQuerying,
  };

  const handleDesktopInspectorClose = useCallback(() => {
    useUIStore.getState().setDetailPanelOpen(false);
  }, []);

  const handleDesktopInspectorOpen = useCallback(() => {
    useUIStore.getState().setDetailPanelOpen(true);
  }, []);

  const handleLeftToggle = useCallback(() => {
    setLeftPanelOpen((prev) => !prev);
  }, []);

  const handleRightToggle = useCallback(() => {
    if (detailPanelOpen) {
      handleDesktopInspectorClose();
    } else {
      handleDesktopInspectorOpen();
    }
  }, [detailPanelOpen, handleDesktopInspectorClose, handleDesktopInspectorOpen]);

  const handleToggleDiff = useCallback(() => {
    setDiffSheetOpen((prev) => !prev);
  }, []);

  const handleExitSlice = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('ai_gen');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    useGraphStore.getState().setLatestSliceId(null);
    // Reload full graph overview
    loadOverview();
  }, [router, pathname, searchParams, loadOverview]);

  // ── Loading overlay shared between mobile & desktop ──
  const loadingOverlay = isDataLoading ? (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
      <div className="space-y-4 text-center">
        <Skeleton className="h-16 w-16 rounded-full mx-auto" />
        <Skeleton className="h-4 w-48 mx-auto" />
        <Skeleton className="h-3 w-32 mx-auto" />
      </div>
    </div>
  ) : null;

  // ── Mobile: full-width canvas + Sheet side panels ──
  if (isMobile) {
    return (
      <div className="relative h-full flex flex-col">
        <GraphFilterToolbar onExitSlice={handleExitSlice} />
        <div className="relative flex-1 min-h-0">
          <D3GraphCanvas className="absolute inset-0" />
          {loadingOverlay}

          {/* FAB: open file tree */}
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-4 left-4 z-10 h-11 w-11 rounded-full shadow-md"
            onClick={() => setMobileTreeOpen(true)}
            aria-label="Open file tree"
          >
            <FolderTree className="h-5 w-5" />
          </Button>

          {/* FAB: open inspector */}
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-4 right-4 z-10 h-11 w-11 rounded-full shadow-md"
            onClick={() => setMobileInspectorOpen(true)}
            aria-label="Open inspector"
          >
            <PanelRight className="h-5 w-5" />
          </Button>
        </div>

        {/* File tree sheet (slides from left) */}
        <Sheet open={mobileTreeOpen} onOpenChange={setMobileTreeOpen}>
          <SheetContent side="left" className="w-[85vw] sm:max-w-sm p-0 flex flex-col gap-0">
            <SheetHeader className="border-b px-3 py-2 shrink-0">
              <SheetTitle className="text-sm font-medium">File Tree</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden min-h-0">
              <AstTreeSidebar />
            </div>
          </SheetContent>
        </Sheet>

        {/* Inspector sheet (slides from right, InspectorPanel has its own header) */}
        <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-[90vw] sm:max-w-md p-0 flex flex-col gap-0"
          >
            <InspectorPanel {...inspectorProps} onClose={() => setMobileInspectorOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // ── Desktop: 3-panel CSS grid layout ──
  return (
    <div
      className="h-full grid overflow-hidden"
      style={{
        gridTemplateColumns: `${leftPanelOpen ? '280px' : '0px'} 1fr ${
          detailPanelOpen ? '420px' : '0px'
        }`,
        transition: 'grid-template-columns 200ms ease',
      }}
    >
      {/* Left: AST File Tree Sidebar */}
      <div className="overflow-hidden min-w-0">
        <AstTreeSidebar />
      </div>

      {/* Center: Graph Canvas */}
      <div className="relative flex flex-col overflow-hidden min-w-0">
        <GraphFilterToolbar
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={detailPanelOpen}
          onToggleLeft={handleLeftToggle}
          onToggleRight={handleRightToggle}
          diffOpen={diffSheetOpen}
          onToggleDiff={handleToggleDiff}
          onExitSlice={handleExitSlice}
        />
        <div className="relative flex-1 min-h-0 min-w-0">
          <D3GraphCanvas className="absolute inset-0" />
          <GraphSearchPanel />
          <GraphMinimap />
          {/* Trace replay controls bar */}
          {totalSteps > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border bg-background/90 backdrop-blur-sm px-4 py-2 shadow-lg text-sm">
              <span className="text-muted-foreground">
                Step {currentStep + 1} / {totalSteps}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={togglePlay}>
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={exitReplay}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Diff Sheet */}
          <Sheet open={diffSheetOpen} onOpenChange={setDiffSheetOpen}>
            <SheetContent side="right" showCloseButton className="w-95 sm:w-105 p-0 flex flex-col gap-0">
              <GraphDiffPanel />
            </SheetContent>
          </Sheet>
        </div>
        {loadingOverlay}
      </div>

      {/* Right: Inspector Panel (Details + AI tabs) */}
      <div className="overflow-hidden min-w-0">
        <InspectorPanel {...inspectorProps} onClose={handleDesktopInspectorClose} />
      </div>
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
      <GraphPageContent />
    </Suspense>
  );
}
