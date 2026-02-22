'use client';

import { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import { FlowControls } from '@/components/trace/flow-controls';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAutoLayout } from '@/hooks/use-auto-layout';
import { useGraphData } from '@/hooks/use-graph-data';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTracePlayback } from '@/hooks/use-trace-playback';
import { useZoomLevel } from '@/hooks/use-zoom-level';
import type { ZoomLevel } from '@/lib/oir/constants';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { GraphControls } from './graph-controls';
import { GraphNavigationHud } from './graph-navigation-hud';
import { GraphSearch } from './graph-search';
import { GraphContextMenu } from './panels/graph-context-menu';
import { GraphFilters } from './panels/graph-filters';
import { NodeDetailPanel } from './panels/node-detail-panel';
import { FlowCanvas } from './flow-canvas';
import { KeyboardShortcutsDialog } from '@/components/shared/keyboard-shortcuts-dialog';
import { createContext } from 'react';

/** Context so components can read zoom level without individual subscriptions */
export const ZoomLevelContext = createContext<ZoomLevel>('function');

function GraphCanvasInner() {
  const flowMode = useGraphStore((s) => s.flowMode);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const isLayouting = useGraphStore((s) => s.isLayouting);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const filtersOpen = useUIStore((s) => s.filtersOpen);
  const pendingReplayTraceId = useUIStore((s) => s.pendingReplayTraceId);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  // React Flow API for camera control
  const reactFlow = useReactFlow();

  // Fetch + transform graph data into graphology
  const { rawEdges, isLoading: isDataLoading } = useGraphData();

  // Trace playback
  const playback = useTracePlayback();

  // Wire up layout engine, keyboard shortcuts, and zoom tracking
  useAutoLayout();
  useKeyboardShortcuts();
  const currentZoomLevel = useZoomLevel();

  // Auto-switch between grouped/individual is now DISABLED.
  // User switches manually via the Grouped/All toggle button.
  // This avoids jarring re-layouts during zoom and allows caching of each view.
  const lastZoomRef = useRef(currentZoomLevel);

  useEffect(() => {
    if (lastZoomRef.current === currentZoomLevel) return;
    lastZoomRef.current = currentZoomLevel;
    // View mode switching is manual — no auto-switch on zoom.
  }, [currentZoomLevel]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const closeContextMenu = () => setContextMenu(null);

  // Fetch trace data when a pending replay is requested
  const traceQuery = trpc.trace.getById.useQuery(
    { projectId: currentProjectId ?? '', traceId: pendingReplayTraceId ?? '' },
    { enabled: !!pendingReplayTraceId && !!currentProjectId, staleTime: 60_000 },
  );

  const startedReplayRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !pendingReplayTraceId ||
      !traceQuery.data?.spans ||
      traceQuery.data.spans.length === 0 ||
      rawEdges.length === 0 ||
      startedReplayRef.current === pendingReplayTraceId
    ) return;

    startedReplayRef.current = pendingReplayTraceId;
    useUIStore.getState().setPendingReplayTraceId(null);
    playback.startReplay(pendingReplayTraceId, traceQuery.data.spans as any, rawEdges);
  }, [pendingReplayTraceId, traceQuery.data, rawEdges, playback]);

  // Auto-pan camera to follow active node during replay
  useEffect(() => {
    if (flowMode !== 'replay' || !activeNodeId) return;
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(activeNodeId)) return;
    const attrs = graph.getNodeAttributes(activeNodeId);
    reactFlow.setCenter(attrs.x, attrs.y, { zoom: 1.5, duration: 400 });
  }, [activeNodeId, flowMode, reactFlow]);

  // Listen for Space key toggle-replay event from canvas-navigation
  useEffect(() => {
    function handleToggle() {
      playback.togglePlay();
    }
    window.addEventListener('omnious:toggle-replay', handleToggle);
    return () => window.removeEventListener('omnious:toggle-replay', handleToggle);
  }, [playback]);

  return (
    <ZoomLevelContext.Provider value={currentZoomLevel}>
      <div className="flex h-full flex-col">
        <GraphControls />

        <div className="relative flex-1 overflow-hidden">
          <FlowCanvas onContextMenu={setContextMenu} />

          <GraphSearch />
          <GraphNavigationHud />
          {filtersOpen && <GraphFilters />}

          {/* Loading overlay — blocks canvas during layout/data processing */}
          {(isLayouting || isDataLoading) && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
              <div className="flex items-center gap-2 rounded-lg border bg-background/90 px-4 py-3 shadow-lg">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {isDataLoading ? 'Loading graph\u2026' : 'Processing layout\u2026'}
                </span>
              </div>
            </div>
          )}

          {contextMenu && (
            <GraphContextMenu
              nodeId={contextMenu.nodeId}
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={closeContextMenu}
            />
          )}

          {flowMode === 'replay' && (
            <FlowControls
              isPlaying={playback.isPlaying}
              currentStep={playback.currentStep}
              totalSteps={playback.totalSteps}
              speed={playback.speed}
              mode={playback.mode}
              currentFlowStep={playback.currentFlowStep}
              callStack={playback.callStack}
              progress={playback.progress}
              onPlay={playback.play}
              onPause={playback.pause}
              onTogglePlay={playback.togglePlay}
              onStepForward={playback.stepForward}
              onStepBackward={playback.stepBackward}
              onSeekTo={playback.seekTo}
              onSetSpeed={playback.setSpeed}
              onSetMode={playback.setMode}
              onExit={playback.exitReplay}
            />
          )}
        </div>

        <Sheet
          open={detailPanelOpen}
          onOpenChange={(open) => {
            if (!open) useUIStore.getState().setDetailPanelOpen(false);
          }}
          modal={false}
        >
          <SheetContent
            side="right"
            className="w-[380px] sm:w-[420px] p-0 border-l"
          >
            <NodeDetailPanel />
          </SheetContent>
        </Sheet>

        <KeyboardShortcutsDialog />
      </div>
    </ZoomLevelContext.Provider>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
