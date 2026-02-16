'use client';

import { useCallback, useRef } from 'react';
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
import { useGraphData } from '@/hooks/use-graph-data';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { GraphControls } from './graph-controls';
import { NodeDetailPanel } from './panels/node-detail-panel';
import { NODE_COLORS } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';

function GraphCanvasInner() {
  const { fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);

  // Fetch + transform graph data into store
  useGraphData();

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
          <ReactFlow
            nodes={nodes}
            edges={edges}
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
