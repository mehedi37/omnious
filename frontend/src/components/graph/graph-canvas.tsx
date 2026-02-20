'use client';

import { useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type OnNodesChange,
  type OnEdgesChange,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from 'next-themes';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useGraphData } from '@/hooks/use-graph-data';
import { useTracePlayback } from '@/hooks/use-trace-playback';
import { trpc } from '@/trpc/client';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { GraphControls } from './graph-controls';
import { NodeDetailPanel } from './panels/node-detail-panel';
import { FlowControls } from '@/components/trace/flow-controls';
import { NODE_COLORS } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';

function GraphCanvasInner() {
  const { fitView, setCenter } = useReactFlow();
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

  // Merge runtime edges into displayed edges during replay
  const displayEdges = useMemo(() => {
    if (flowMode !== 'replay' || runtimeEdges.length === 0) return edges;
    return [...edges, ...runtimeEdges];
  }, [edges, runtimeEdges, flowMode]);

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
    playback.startReplay(
      pendingReplayTraceId,
      traceQuery.data.spans as any,
      rawEdges,
    );
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

  return (
    <div className="flex h-full flex-col">
      <GraphControls />
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={detailPanelOpen ? 70 : 100} minSize={40}>
          <div className="relative w-full h-full">
            <ReactFlow
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
              fitView
              minZoom={0.1}
              maxZoom={4}
              defaultEdgeOptions={{ animated: false }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor={(node) => {
                  const data = node.data as GraphNodeData;
                  return NODE_COLORS[data.oirType] ?? '#888';
                }}
                maskColor="rgba(0,0,0,0.1)"
                pannable
                zoomable
              />
            </ReactFlow>

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

        {detailPanelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
              <NodeDetailPanel />
            </ResizablePanel>
          </>
        )}
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
