'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type OnConnect,
  type NodeMouseHandler,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Loader2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { OmniousNode } from './nodes/omnious-node';
import { ModuleGroupNode } from './nodes/module-group-node';
import { AnimatedFlowEdge } from './edges/animated-flow-edge';
import { useGraphContextMenu } from './graph-context-menu';
import type { OmniousNode as OmniousNodeType, OmniousEdge } from '@/lib/stores/graph-store';

// Register custom node/edge types
const nodeTypes = {
  omnious: OmniousNode,
  group: ModuleGroupNode,
};

const edgeTypes = {
  'animated-flow': AnimatedFlowEdge,
};

/**
 * React Flow canvas for AI-driven subgraph visualization.
 * Replaces sigma-canvas.tsx — renders focused subgraphs (<100 nodes)
 * from AI queries with animated edges and type-colored nodes.
 */
export function ReactFlowCanvas() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const isLayouting = useGraphStore((s) => s.isLayouting);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const connectedNodeIds = useGraphStore((s) => s.connectedNodeIds);
  const nodeTypeFilters = useGraphStore((s) => s.nodeTypeFilters);
  const severityFilters = useGraphStore((s) => s.severityFilters);
  const pinnedNodeIds = useGraphStore((s) => s.pinnedNodeIds);
  const minimapVisible = useUIStore((s) => s.minimapVisible);

  const [nodes, setNodes, onNodesChange] = useNodesState<OmniousNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<OmniousEdge>([]);

  const { fitView } = useReactFlow();
  const hasFittedRef = useRef(false);

  // Context menu hook
  const { onNodeContextMenu, onPaneContextMenu, setContainerRef, menuElement } =
    useGraphContextMenu();

  // Pin all nodes when a new graph loads (lock-by-default)
  useEffect(() => {
    if (storeNodes.length > 0) {
      const allIds = new Set(storeNodes.map((n) => n.id));
      const currentPinned = useGraphStore.getState().pinnedNodeIds;
      // Only auto-pin if there are new nodes not yet tracked
      if (currentPinned.size === 0 || storeNodes.some((n) => !currentPinned.has(n.id))) {
        useGraphStore.getState().pinAll();
      }
    }
  }, [storeNodes]);

  // Sync store → React Flow state (with filtering + pinning)
  useEffect(() => {
    let filteredNodes = storeNodes;

    // Apply node type filters
    if (nodeTypeFilters.size > 0) {
      filteredNodes = storeNodes.filter((n) => !nodeTypeFilters.has(n.data.oirType));
    }

    // Apply severity filters — hide error-annotated nodes whose severity isn't in the active set
    if (severityFilters.size > 0) {
      filteredNodes = filteredNodes.filter((n) => {
        const sev = n.data.errorSeverity as string | undefined;
        if (!sev) return true; // always show nodes with no errors
        return severityFilters.has(sev as 'error' | 'warning' | 'info');
      });
    }

    // Apply focus mode — hide non-connected nodes
    if (focusedNodeId && connectedNodeIds.size > 0) {
      filteredNodes = filteredNodes.filter((n) => connectedNodeIds.has(n.id));
    }

    // Mark selected nodes + apply pin state
    const withSelection = filteredNodes.map((n) => ({
      ...n,
      selected: selectedNodeIds.has(n.id),
      draggable: !pinnedNodeIds.has(n.id),
    }));

    setNodes(withSelection);

    // Filter edges to only include those between visible nodes
    const visibleIds = new Set(withSelection.map((n) => n.id));
    const filteredEdges = storeEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
    setEdges(filteredEdges);
  }, [storeNodes, storeEdges, nodeTypeFilters, severityFilters, focusedNodeId, connectedNodeIds, selectedNodeIds, pinnedNodeIds, setNodes, setEdges]);

  // Fit view when new data arrives
  useEffect(() => {
    if (nodes.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true;
      // Small delay to let React Flow render nodes first
      requestAnimationFrame(() => {
        fitView({ padding: 0.15, duration: 400 });
      });
    }
  }, [nodes.length, fitView]);

  // Reset fit flag when graph is cleared
  useEffect(() => {
    if (storeNodes.length === 0) {
      hasFittedRef.current = false;
    }
  }, [storeNodes.length]);

  // Listen for omnious:focus-fit event (layout complete, focus mode, etc.)
  useEffect(() => {
    function handleFit() {
      fitView({ padding: 0.15, duration: 400 });
    }
    window.addEventListener('omnious:focus-fit', handleFit);
    return () => window.removeEventListener('omnious:focus-fit', handleFit);
  }, [fitView]);

  // Node click → select + open detail panel
  const onNodeClick: NodeMouseHandler<OmniousNodeType> = useCallback((_event, node) => {
    useGraphStore.getState().selectNode(node.id);
    useUIStore.getState().setDetailPanelOpen(true);
  }, []);

  // Double-click → focus mode (2-hop subgraph)
  const onNodeDoubleClick: NodeMouseHandler<OmniousNodeType> = useCallback((_event, node) => {
    useGraphStore.getState().setFocusMode(node.id);
    window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
  }, []);

  // First-drag hint: if node is pinned, show a one-time toast
  const onNodeDragStart: NodeMouseHandler<OmniousNodeType> = useCallback((_event, node) => {
    const isPinned = useGraphStore.getState().pinnedNodeIds.has(node.id);
    if (isPinned) {
      const hasSeenHint = localStorage.getItem('omnious:lock-hint-seen');
      if (!hasSeenHint) {
        localStorage.setItem('omnious:lock-hint-seen', '1');
        toast.info('Nodes are locked — click 🔓 in the controls to unlock', {
          duration: 4000,
        });
      }
    }
  }, []);

  // Canvas click → deselect
  const onPaneClick = useCallback(() => {
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
  }, []);

  // Prevent adding edges by dragging
  const onConnect: OnConnect = useCallback(() => {}, []);

  // Lock toggle
  const allPinned = pinnedNodeIds.size >= storeNodes.length && storeNodes.length > 0;
  const handleToggleLock = useCallback(() => {
    if (allPinned) {
      useGraphStore.getState().unpinAll();
    } else {
      useGraphStore.getState().pinAll();
    }
  }, [allPinned]);

  // MiniMap node color based on OIR type
  const miniMapNodeColor = useCallback((node: OmniousNodeType) => {
    const type = node.data?.oirType;
    // Use a simplified color mapping for the minimap
    const colorMap: Record<string, string> = {
      function: '#22c55e',
      component: '#3b82f6',
      route: '#f97316',
      module: '#64748b',
      class: '#6366f1',
      database_query: '#a855f7',
      package: '#818cf8',
    };
    return colorMap[type ?? ''] ?? '#64748b';
  }, []);

  return (
    <div className="h-full w-full relative" ref={setContainerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        defaultEdgeOptions={{
          type: 'animated-flow',
          animated: true,
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          className="bg-background!"
        />
        <Controls
          showInteractive={false}
          className="bg-background! border-border! shadow-md!"
        >
          <ControlButton
            onClick={handleToggleLock}
            title={allPinned ? 'Unlock all nodes' : 'Lock all nodes'}
          >
            {allPinned ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          </ControlButton>
        </Controls>
        {minimapVisible && (
          <MiniMap
            nodeColor={miniMapNodeColor}
            className="bg-background/80! border-border!"
            maskColor="oklch(0.2 0 0 / 0.3)"
            pannable
            zoomable
            style={{ width: 150, height: 100 }}
          />
        )}
      </ReactFlow>

      {/* Context menu overlay */}
      {menuElement}

      {/* Layout processing overlay */}
      {isLayouting && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center gap-2 rounded-lg border bg-background/90 px-4 py-3 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Processing layout…</span>
          </div>
        </div>
      )}
    </div>
  );
}
