'use client';

import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type OnConnect,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { Loader2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import type { OmniousEdge, OmniousNode as OmniousNodeType } from '@/lib/stores/graph-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { AnimatedFlowEdge } from './edges/animated-flow-edge';
import { useGraphContextMenu } from './graph-context-menu';
import { ModuleGroupNode } from './nodes/module-group-node';
import { OmniousNode } from './nodes/omnious-node';

// Register custom node/edge types
const nodeTypes = {
  omnious: OmniousNode,
  group: ModuleGroupNode,
};

const edgeTypes = {
  'animated-flow': AnimatedFlowEdge,
};

/** Shallow compare two Sets by size + membership */
function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * React Flow canvas for AI-driven subgraph visualization.
 * Replaces sigma-canvas.tsx — renders focused subgraphs (<100 nodes)
 * from AI queries with animated edges and type-colored nodes.
 */
export function ReactFlowCanvas() {
  const storeNodes = useGraphStore((s) => s.nodes);
  const storeEdges = useGraphStore((s) => s.edges);
  const isLayouting = useGraphStore((s) => s.isLayouting);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const minimapVisible = useUIStore((s) => s.minimapVisible);

  const [nodes, setNodes, onNodesChange] = useNodesState<OmniousNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<OmniousEdge>([]);

  const { fitView } = useReactFlow();

  // Context menu hook
  const { onNodeContextMenu, onPaneContextMenu, setContainerRef, menuElement } =
    useGraphContextMenu();

  // Track the graph's identity (sorted node IDs) so we only auto-pin when a new graph loads
  const graphSignatureRef = useRef<string>('');

  // Refs to track Set state without re-renders
  const selectedRef = useRef<Set<string>>(new Set());
  const pinnedRef = useRef<Set<string>>(new Set());
  const connectedRef = useRef<Set<string>>(new Set());
  const nodeTypeFiltersRef = useRef(new Set());
  const severityFiltersRef = useRef(new Set());

  // Pin all nodes on initial graph load only (lock-by-default).
  useEffect(() => {
    if (storeNodes.length === 0) return;
    const signature = storeNodes
      .map((n) => n.id)
      .sort()
      .join(',');
    if (signature === graphSignatureRef.current) return;
    graphSignatureRef.current = signature;
    useGraphStore.getState().pinAll();
  }, [storeNodes]);

  // ── Effect 1: Sync store nodes/edges → React Flow (filtering only) ───────
  // Runs when the graph data, filters, or focus changes — NOT on selection/pin toggles.
  const nodeTypeFilters = useGraphStore((s) => s.nodeTypeFilters);
  const severityFilters = useGraphStore((s) => s.severityFilters);
  const connectedNodeIds = useGraphStore((s) => s.connectedNodeIds);

  useEffect(() => {
    let filteredNodes = storeNodes;

    if (nodeTypeFilters.size > 0) {
      filteredNodes = storeNodes.filter((n) => !nodeTypeFilters.has(n.data.oirType));
    }

    if (severityFilters.size > 0) {
      filteredNodes = filteredNodes.filter((n) => {
        const sev = n.data.errorSeverity as string | undefined;
        if (!sev) return true;
        return severityFilters.has(sev as 'error' | 'warning' | 'info');
      });
    }

    if (focusedNodeId && connectedNodeIds.size > 0) {
      filteredNodes = filteredNodes.filter((n) => connectedNodeIds.has(n.id));
    }

    // Apply current selection + pin state without subscribing to them
    const selected = useGraphStore.getState().selectedNodeIds;
    const pinned = useGraphStore.getState().pinnedNodeIds;
    selectedRef.current = selected;
    pinnedRef.current = pinned;
    connectedRef.current = connectedNodeIds;
    nodeTypeFiltersRef.current = nodeTypeFilters;
    severityFiltersRef.current = severityFilters;

    const withState = filteredNodes.map((n) => ({
      ...n,
      selected: selected.has(n.id),
      draggable: !pinned.has(n.id),
    }));

    setNodes(withState);

    const visibleIds = new Set(withState.map((n) => n.id));
    const filteredEdges = storeEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
    setEdges(filteredEdges);
  }, [
    storeNodes,
    storeEdges,
    nodeTypeFilters,
    severityFilters,
    focusedNodeId,
    connectedNodeIds,
    setNodes,
    setEdges,
  ]);

  // ── Effect 2: Selection changes — patch in-place via callback ─────────
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);

  useEffect(() => {
    if (setsEqual(selectedRef.current, selectedNodeIds)) return;
    selectedRef.current = selectedNodeIds;
    setNodes((prev) =>
      prev.map((n) => {
        const shouldBeSelected = selectedNodeIds.has(n.id);
        if (n.selected === shouldBeSelected) return n; // preserve identity
        return { ...n, selected: shouldBeSelected };
      }),
    );
  }, [selectedNodeIds, setNodes]);

  // ── Effect 3: Pin changes — patch draggable in-place ──────────────────
  const pinnedNodeIds = useGraphStore((s) => s.pinnedNodeIds);

  useEffect(() => {
    if (setsEqual(pinnedRef.current, pinnedNodeIds)) return;
    pinnedRef.current = pinnedNodeIds;
    setNodes((prev) =>
      prev.map((n) => {
        const shouldBeDraggable = !pinnedNodeIds.has(n.id);
        if (n.draggable === shouldBeDraggable) return n;
        return { ...n, draggable: shouldBeDraggable };
      }),
    );
  }, [pinnedNodeIds, setNodes]);

  // ── Single fitView: triggered after layout completes ──────────────────
  useEffect(() => {
    function handleFit() {
      fitView({ padding: 0.15, duration: 0 });
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

  // Canvas click → deselect only (do NOT close inspector — use toolbar button)
  const onPaneClick = useCallback(() => {
    useGraphStore.getState().deselectAll();
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
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        defaultEdgeOptions={{
          type: 'animated-flow',
          animated: true,
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="bg-background!" />
        <Controls showInteractive={false} className="bg-background! border-border! shadow-md!">
          <ControlButton
            onClick={handleToggleLock}
            title={allPinned ? 'Unlock all nodes' : 'Lock all nodes'}
          >
            {allPinned ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
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
      {isLayouting && <LayoutOverlay nodeCount={storeNodes.length} />}
    </div>
  );
}

/** Shows layout progress with node count and a delayed hint for large graphs */
function LayoutOverlay({ nodeCount }: { nodeCount: number }) {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-1 rounded-lg border bg-background/90 px-4 py-3 shadow-lg">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Laying out {nodeCount} node{nodeCount !== 1 ? 's' : ''}…
          </span>
        </div>
        {showHint && (
          <span className="text-xs text-muted-foreground/70">Large graphs may take longer</span>
        )}
      </div>
    </div>
  );
}
