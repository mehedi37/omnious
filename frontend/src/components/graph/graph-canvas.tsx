'use client';

import {
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { useTheme } from 'next-themes';
import { useShallow } from 'zustand/react/shallow';
import { FlowControls } from '@/components/trace/flow-controls';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useAutoLayout } from '@/hooks/use-auto-layout';
import { useGraphData } from '@/hooks/use-graph-data';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTracePlayback } from '@/hooks/use-trace-playback';
import { useZoomLevel } from '@/hooks/use-zoom-level';
import { ZOOM_THRESHOLDS, NODE_COLORS } from '@/lib/oir/constants';
import type { ZoomLevel } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { edgeTypes } from './edges';
import { GraphControls } from './graph-controls';
import { GraphSearch } from './graph-search';
import { GraphContextMenu } from './panels/graph-context-menu';
import { nodeTypes } from './nodes';
import { NodeDetailPanel } from './panels/node-detail-panel';
import { createContext } from 'react';

/** Context so node components can read zoom level without individual Zustand subscriptions */
export const ZoomLevelContext = createContext<ZoomLevel>('function');

function GraphCanvasInner() {
  const { setCenter } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const flowMode = useGraphStore((s) => s.flowMode);
  const runtimeEdges = useGraphStore((s) => s.runtimeEdges);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const pendingReplayTraceId = useUIStore((s) => s.pendingReplayTraceId);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  // Fetch + transform graph data into store
  const { rawEdges } = useGraphData();

  // Trace playback
  const playback = useTracePlayback();

  // Wire up layout engine, keyboard shortcuts, and zoom tracking
  useAutoLayout();
  useKeyboardShortcuts();
  const currentZoomLevel = useZoomLevel();

  // Switch between grouped ↔ individual view based on zoom level.
  // Below the module threshold → show grouped (directory-level summary).
  // Above module threshold → show individual nodes.
  // Debounced via ref to avoid rapid switching near the threshold.
  const viewSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastZoomRef = useRef(currentZoomLevel);

  useEffect(() => {
    // Don't switch view during trace replay — always show individuals
    const store = useGraphStore.getState();
    if (store.flowMode === 'replay') return;

    // Only trigger on actual zoom level change
    if (lastZoomRef.current === currentZoomLevel) return;
    lastZoomRef.current = currentZoomLevel;

    if (viewSwitchTimerRef.current) {
      clearTimeout(viewSwitchTimerRef.current);
    }

    viewSwitchTimerRef.current = setTimeout(() => {
      const current = useGraphStore.getState();
      // No grouped data available yet → skip
      if (current.groupNodes.length === 0) return;

      const shouldGroup = currentZoomLevel === 'service' || currentZoomLevel === 'module';
      const targetMode = shouldGroup ? 'grouped' : 'individual';

      if (current.viewMode !== targetMode) {
        current.setViewMode(targetMode);
        // Trigger re-layout for the new node set
        setTimeout(() => current.requestLayout(), 50);
      }
    }, 300);

    return () => {
      if (viewSwitchTimerRef.current) {
        clearTimeout(viewSwitchTimerRef.current);
      }
    };
  }, [currentZoomLevel]);

  // Focus mode — single combined selector to avoid extra subscriptions
  // shallow equality required: selector returns a plain object (object identity always differs)
  const focusState = useGraphStore(
    useShallow((s) => ({ focusedNodeId: s.focusedNodeId, connectedNodeIds: s.connectedNodeIds })),
  );

  // Merge runtime edges during replay + apply focus dimming
  const displayEdges = useMemo(() => {
    let result =
      flowMode !== 'replay' || runtimeEdges.length === 0 ? edges : [...edges, ...runtimeEdges];

    // Dim edges outside the focus neighborhood
    if (focusState.focusedNodeId) {
      result = result.map((edge) => {
        const isInFocus =
          focusState.connectedNodeIds.has(edge.source) &&
          focusState.connectedNodeIds.has(edge.target);
        if (isInFocus) return edge;
        return { ...edge, style: { ...edge.style, opacity: 0.06 }, animated: false };
      });
    }

    return result;
  }, [edges, runtimeEdges, flowMode, focusState.focusedNodeId, focusState.connectedNodeIds]);

  // Fetch trace data when a pending replay is requested
  const traceQuery = trpc.trace.getById.useQuery(
    { projectId: currentProjectId ?? '', traceId: pendingReplayTraceId ?? '' },
    { enabled: !!pendingReplayTraceId && !!currentProjectId, staleTime: 60_000 },
  );

  // Start replay when trace data arrives
  const startedReplayRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !pendingReplayTraceId ||
      !traceQuery.data?.spans ||
      traceQuery.data.spans.length === 0 ||
      rawEdges.length === 0 ||
      startedReplayRef.current === pendingReplayTraceId
    ) {
      return;
    }

    startedReplayRef.current = pendingReplayTraceId;
    useUIStore.getState().setPendingReplayTraceId(null);
    playback.startReplay(pendingReplayTraceId, traceQuery.data.spans as any, rawEdges);
  }, [pendingReplayTraceId, traceQuery.data, rawEdges, playback]);

  // Auto-pan camera to follow active node during replay
  useEffect(() => {
    if (flowMode !== 'replay' || !activeNodeId) return;
    const node = nodes.find((n) => n.id === activeNodeId);
    if (!node?.position) return;

    const x = node.position.x + (node.measured?.width ?? 200) / 2;
    const y = node.position.y + (node.measured?.height ?? 60) / 2;
    setCenter(x, y, { duration: 400, zoom: 1.2 });
  }, [activeNodeId, flowMode, nodes, setCenter]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => useGraphStore.getState().applyNodeChanges(changes),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => useGraphStore.getState().applyEdgeChanges(changes),
    [],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    useGraphStore.getState().selectNode(node.id);
    useUIStore.getState().setDetailPanelOpen(true);
  }, []);

  const onPaneClick = useCallback(() => {
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Imperative fitView on initial data load only
  const { fitView } = useReactFlow();
  const hasFittedRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true;
      // Wait for React Flow to measure and render nodes before fitting
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitView({ duration: 400 }));
      });
    }
  }, [nodes.length, fitView]);

  return (
    <div className="flex h-full flex-col">
      <GraphControls />
      <ResizablePanelGroup
        orientation="horizontal"
        className="flex-1"
      >
        <ResizablePanel defaultSize={70} minSize={40}>
          <div className="relative w-full h-full">
            <ZoomLevelContext.Provider value={currentZoomLevel}>
              <ReactFlow
                nodes={nodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                onPaneClick={onPaneClick}
                colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
                minZoom={0.1}
                maxZoom={4}
                defaultEdgeOptions={{ animated: false }}
                proOptions={{ hideAttribution: true }}
                onlyRenderVisibleElements
              >
                <Background gap={16} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeColor={(node) => {
                    const data = node.data as any;
                    // Group nodes use dominantType, individual nodes use oirType
                    const type = data.oirType ?? data.dominantType;
                    return type ? (NODE_COLORS[type as keyof typeof NODE_COLORS] ?? '#888') : '#888';
                  }}
                  maskColor="rgba(0,0,0,0.1)"
                  pannable
                  zoomable
                />
              </ReactFlow>
            </ZoomLevelContext.Provider>

            {/* Floating node search */}
            <GraphSearch />

            {/* Node context menu */}
            {contextMenu && (
              <GraphContextMenu
                nodeId={contextMenu.nodeId}
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={closeContextMenu}
              />
            )}

            {/* Flow Controls overlay during trace replay */}
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
        </ResizablePanel>

        <ResizableHandle withHandle className={detailPanelOpen ? '' : 'hidden'} />
        <ResizablePanel
          defaultSize={30}
          minSize={detailPanelOpen ? 20 : 0}
          maxSize={detailPanelOpen ? 50 : 0}
          className={detailPanelOpen ? '' : 'hidden'}
        >
          <NodeDetailPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
