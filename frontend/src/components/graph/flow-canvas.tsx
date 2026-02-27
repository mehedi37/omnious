'use client';

import {
  ReactFlow,
  Background,
  MiniMap,
  PanOnScrollMode,
  type OnNodesChange,
  type OnEdgesChange,
  type OnSelectionChangeFunc,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
  useOnViewportChange,
  useReactFlow,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { graphRef, useGraphStore, type RFNodeData } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { ZOOM_THRESHOLDS, type ZoomLevel } from '@/lib/oir/constants';

/**
 * Flow canvas — wraps <ReactFlow> with our graphology-synced state.
 * Replaces SigmaCanvas. All rendering logic lives in custom node/edge components.
 */

interface FlowCanvasProps {
  onContextMenu?: (menu: { nodeId: string; x: number; y: number }) => void;
}

export function FlowCanvas({ onContextMenu }: FlowCanvasProps) {
  const { resolvedTheme } = useTheme();
  const reactFlow = useReactFlow();
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const rfEdges = useGraphStore((s) => s.rfEdges);

  // Listen for center-node events from the detail panel's connected nodes
  useEffect(() => {
    function handleCenter(e: Event) {
      const { x, y } = (e as CustomEvent).detail;
      const viewport = reactFlow.getViewport();
      const width = window.innerWidth;
      // Place node at ~25% from left edge (same as onNodeClick)
      const offsetX = (width * 0.25) / viewport.zoom;
      reactFlow.setCenter(x + offsetX, y, { zoom: viewport.zoom, duration: 400 });
    }
    function handleFocusFit() {
      // Auto-fit all connected nodes into viewport with padding
      setTimeout(() => {
        reactFlow.fitView({ padding: 0.25, duration: 400 });
      }, 50);
    }
    window.addEventListener('omnious:center-node', handleCenter);
    window.addEventListener('omnious:focus-fit', handleFocusFit);
    return () => {
      window.removeEventListener('omnious:center-node', handleCenter);
      window.removeEventListener('omnious:focus-fit', handleFocusFit);
    };
  }, [reactFlow]);

  // Derive colorMode from theme
  const colorMode = resolvedTheme === 'dark' ? 'dark' : 'light';

  // Handle node position changes from drag
  const onNodesChange: OnNodesChange = (changes) => {
    const currentNodes = useGraphStore.getState().rfNodes;
    const updated = applyNodeChanges(changes, currentNodes);

    // Write position changes back to graphology
    const graph = graphRef.current;
    for (const change of changes) {
      if (change.type === 'position' && change.position && graph?.hasNode(change.id)) {
        graph.setNodeAttribute(change.id, 'x', change.position.x);
        graph.setNodeAttribute(change.id, 'y', change.position.y);
      }
    }

    // Update RF nodes directly in store (avoids full rebuild)
    useGraphStore.setState({ rfNodes: updated as any });
  };

  const onEdgesChange: OnEdgesChange = (changes) => {
    const currentEdges = useGraphStore.getState().rfEdges;
    const updated = applyEdgeChanges(changes, currentEdges);
    useGraphStore.setState({ rfEdges: updated as any });
  };

  // Click node → select + open detail panel + highlight connected edges
  const onNodeClick: NodeMouseHandler = (_event, node) => {
    useGraphStore.getState().selectNode(node.id);
    useGraphStore.getState().highlightConnectedEdges(node.id);
    const wasOpen = useUIStore.getState().detailPanelOpen;
    useUIStore.getState().setDetailPanelOpen(true);
    // Only pan viewport when opening the panel for the first time
    // to avoid disorienting camera jumps on every click
    if (!wasOpen) {
      const graph = graphRef.current;
      if (graph && graph.hasNode(node.id)) {
        const attrs = graph.getNodeAttributes(node.id);
        const viewport = reactFlow.getViewport();
        const width = window.innerWidth;
        const offsetX = (width * 0.25) / viewport.zoom;
        reactFlow.setCenter(attrs.x + offsetX, attrs.y, { zoom: viewport.zoom, duration: 300 });
      }
    }
  };

  // Double-click group → expand
  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => {
    const data = node.data as any;
    if (data?.isGroup) {
      useGraphStore.getState().toggleGroupExpanded(node.id);
    }
  };

  // Right-click → context menu
  const onNodeContextMenu: NodeMouseHandler = (event, node) => {
    event.preventDefault();
    useGraphStore.getState().selectNode(node.id);
    onContextMenu?.({
      nodeId: node.id,
      x: (event as any).clientX ?? 0,
      y: (event as any).clientY ?? 0,
    });
  };

  // Click empty canvas → deselect
  const onSelectionChange: OnSelectionChangeFunc = ({ nodes }) => {
    const ids = new Set(nodes.map((n) => n.id));
    const current = useGraphStore.getState().selectedNodeIds;
    // Only update if selection actually changed
    if (ids.size !== current.size || [...ids].some((id) => !current.has(id))) {
      useGraphStore.setState({ selectedNodeIds: ids });
    }
  };

  const onPaneClick = () => {
    // Don't deselect or close detail panel — keep sidebar open until explicit close
    useGraphStore.getState().highlightConnectedEdges(null);
    useGraphStore.getState().setKeyboardFocusedNode(null);
  };

  // Track viewport zoom → derive zoom level (replaces sigma camera polling)
  useOnViewportChange({
    onChange: (viewport: Viewport) => {
      const zoom = viewport.zoom;
      let level: ZoomLevel = 'detail';
      if (zoom < ZOOM_THRESHOLDS.service) level = 'service';
      else if (zoom < ZOOM_THRESHOLDS.module) level = 'module';
      else if (zoom < ZOOM_THRESHOLDS.function) level = 'function';

      const currentLevel = useGraphStore.getState().zoomLevel;
      if (currentLevel !== level) {
        useGraphStore.getState().setZoomLevel(level);
      }
    },
  });

  // Mark selected nodes
  function miniMapNodeColor(node: { data: Record<string, unknown> }) {
    return (node.data as RFNodeData).color ?? '#888';
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onNodeContextMenu={onNodeContextMenu}
      onPaneClick={onPaneClick}
      colorMode={colorMode}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.1}
      maxZoom={3}
      translateExtent={[[-8000, -8000], [12000, 12000]]}
      onlyRenderVisibleElements
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Free}
      zoomOnScroll={false}
      zoomOnPinch
      nodesFocusable
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'routed' }}
    >
      <Background gap={20} size={1} />
      <MiniMap
        nodeColor={miniMapNodeColor}
        maskColor={resolvedTheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(240,240,240,0.7)'}
        pannable
        zoomable
        style={{ width: 200, height: 140 }}
        className="!bottom-2 !left-2 !rounded-lg !border !shadow-sm"
      />
    </ReactFlow>
  );
}
