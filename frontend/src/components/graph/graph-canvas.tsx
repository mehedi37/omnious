'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { FlowControls } from '@/components/trace/flow-controls';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAutoLayout } from '@/hooks/use-auto-layout';
import { useGraphData } from '@/hooks/use-graph-data';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTracePlayback } from '@/hooks/use-trace-playback';
import { useZoomLevel } from '@/hooks/use-zoom-level';
import type { ZoomLevel } from '@/lib/oir/constants';
import { sigmaRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { GraphControls } from './graph-controls';
import { GraphNavigationHud } from './graph-navigation-hud';
import { GraphSearch } from './graph-search';
import { GraphContextMenu } from './panels/graph-context-menu';
import { NodeDetailPanel } from './panels/node-detail-panel';
import { SigmaCanvas } from './sigma-canvas';
import { createContext } from 'react';

/** Context so components can read zoom level without individual subscriptions */
export const ZoomLevelContext = createContext<ZoomLevel>('function');

export function GraphCanvas() {
  const flowMode = useGraphStore((s) => s.flowMode);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const pendingReplayTraceId = useUIStore((s) => s.pendingReplayTraceId);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  // Fetch + transform graph data into graphology
  const { rawEdges } = useGraphData();

  // Trace playback
  const playback = useTracePlayback();

  // Wire up layout engine, keyboard shortcuts, and zoom tracking
  useAutoLayout();
  useKeyboardShortcuts();
  const currentZoomLevel = useZoomLevel();

  // Auto switch between grouped / individual view based on zoom level.
  const viewSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastZoomRef = useRef(currentZoomLevel);

  useEffect(() => {
    if (useGraphStore.getState().flowMode === 'replay') return;
    if (lastZoomRef.current === currentZoomLevel) return;
    lastZoomRef.current = currentZoomLevel;

    if (viewSwitchTimerRef.current) clearTimeout(viewSwitchTimerRef.current);

    viewSwitchTimerRef.current = setTimeout(() => {
      const store = useGraphStore.getState();
      const shouldGroup = currentZoomLevel === 'service' || currentZoomLevel === 'module';
      const target = shouldGroup ? 'grouped' : 'individual';
      if (store.viewMode !== target) {
        store.setViewMode(target);
        setTimeout(() => store.requestLayout(), 50);
      }
    }, 300);

    return () => { if (viewSwitchTimerRef.current) clearTimeout(viewSwitchTimerRef.current); };
  }, [currentZoomLevel]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

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
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    if (!graph.hasNode(activeNodeId)) return;
    const attrs = graph.getNodeAttributes(activeNodeId);
    sigma.getCamera().animate({ x: attrs.x, y: attrs.y, ratio: 0.4 }, { duration: 400 });
  }, [activeNodeId, flowMode]);

  // Pass setContextMenu down to SigmaCanvas via a stable ref
  const contextMenuSetterRef = useRef(setContextMenu);
  useEffect(() => { contextMenuSetterRef.current = setContextMenu; });

  return (
    <ZoomLevelContext.Provider value={currentZoomLevel}>
      <div className="flex h-full flex-col">
        <GraphControls />

        <div className="relative flex-1 overflow-hidden">
          <SigmaCanvas onContextMenu={contextMenuSetterRef} />

          <GraphSearch />
          <GraphNavigationHud />

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
            if (!open) {
              useGraphStore.getState().deselectAll();
              useUIStore.getState().setDetailPanelOpen(false);
            }
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
      </div>
    </ZoomLevelContext.Provider>
  );
}
