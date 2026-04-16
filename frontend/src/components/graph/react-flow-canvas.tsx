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
import { useCallback, useEffect, useRef, startTransition, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { Keyboard, Loader2, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import type { OmniousEdge, OmniousNode as OmniousNodeType } from '@/lib/stores/graph-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { AnimatedFlowEdge } from './edges/animated-flow-edge';
import { GraphGlobalFlagsContext } from './graph-global-flags-context';
import { useGraphContextMenu } from './graph-context-menu';
import { ModuleGroupNode } from './nodes/module-group-node';
import { OmniousNode } from './nodes/omnious-node';
import { AISliceAnnotation, type SliceNarrative } from './ai-slice-annotation';
import { KeyboardShortcutsDialog } from '@/components/shared/keyboard-shortcuts-dialog';

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

/** Maximum nodes passed to ReactFlow at once. Above this limit a warning is shown. */
const NODE_RENDER_LIMIT = 500;

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
  const sliceNarrative = useGraphStore((s) => s.sliceNarrative);
  const minimapVisible = useUIStore((s) => s.minimapVisible);

  // Global flags — read once here, provided via context to all nodes (avoids N×3 per-node subscriptions)
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const errorFlowActive = useGraphStore((s) => s.errorFlowNodeIds.size > 0);
  const focusActive = focusedNodeId !== null;

  const [nodes, setNodes, onNodesChange] = useNodesState<OmniousNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<OmniousEdge>([]);

  const { fitView, getNodes } = useReactFlow();

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
  const tooManyNodesWarnedRef = useRef(false);

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
    if (storeNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    let filteredNodes = storeNodes;

    if (nodeTypeFilters.size > 0) {
      filteredNodes = storeNodes.filter((n) =>
        (n.type as string) === 'group' || !nodeTypeFilters.has(n.data.oirType),
      );
    }

    if (severityFilters.size > 0) {
      filteredNodes = filteredNodes.filter((n) => {
        if ((n.type as string) === 'group') return true;
        const sev = n.data.errorSeverity as string | undefined;
        if (!sev) return true;
        return severityFilters.has(sev as 'error' | 'warning' | 'info');
      });
    }

    if (focusedNodeId && connectedNodeIds.size > 0) {
      filteredNodes = filteredNodes.filter((n) => connectedNodeIds.has(n.id));
    }

    // Hard cap: prevent main-thread freeze on very large graphs
    if (filteredNodes.length > NODE_RENDER_LIMIT) {
      if (!tooManyNodesWarnedRef.current) {
        tooManyNodesWarnedRef.current = true;
        toast.warning(
          `Showing ${NODE_RENDER_LIMIT} of ${filteredNodes.length} nodes — use AI query for a focused subgraph.`,
          { duration: 6000 },
        );
      }
      filteredNodes = filteredNodes.slice(0, NODE_RENDER_LIMIT);
    } else {
      tooManyNodesWarnedRef.current = false;
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

    const visibleIds = new Set(withState.map((n) => n.id));
    const filteredEdges = storeEdges.filter(
      (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
    );
    startTransition(() => {
      setNodes(withState);
      setEdges(filteredEdges);
    });
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
    startTransition(() => {
      setNodes((prev) =>
        prev.map((n) => {
          const shouldBeSelected = selectedNodeIds.has(n.id);
          if (n.selected === shouldBeSelected) return n; // preserve identity
          return { ...n, selected: shouldBeSelected };
        }),
      );
    });
  }, [selectedNodeIds, setNodes]);

  // ── Effect 3: Pin changes — patch draggable in-place ──────────────────
  const pinnedNodeIds = useGraphStore((s) => s.pinnedNodeIds);

  useEffect(() => {
    if (setsEqual(pinnedRef.current, pinnedNodeIds)) return;
    pinnedRef.current = pinnedNodeIds;
    startTransition(() => {
      setNodes((prev) =>
        prev.map((n) => {
          const shouldBeDraggable = !pinnedNodeIds.has(n.id);
          if (n.draggable === shouldBeDraggable) return n;
          return { ...n, draggable: shouldBeDraggable };
        }),
      );
    });
  }, [pinnedNodeIds, setNodes]);

  // ── fitView: triggered after layout completes ────────────────────────
  useEffect(() => {
    function handleFit() {
      fitView({ padding: 0.2, duration: 500 });
    }
    window.addEventListener('omnious:focus-fit', handleFit);
    return () => window.removeEventListener('omnious:focus-fit', handleFit);
  }, [fitView]);

  // ── focus-node: zoom to a specific node ───────────────────────────────
  useEffect(() => {
    function handleFocusNode(e: Event) {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      if (!nodeId) return;
      const target = getNodes().find((n) => n.id === nodeId);
      if (target) {
        fitView({ nodes: [target], padding: 0.5, duration: 300, maxZoom: 1.5 });
      }
    }
    window.addEventListener('omnious:focus-node', handleFocusNode);
    return () => window.removeEventListener('omnious:focus-node', handleFocusNode);
  }, [fitView, getNodes]);

  // Node click → select + open detail panel + zoom to node
  const onNodeClick: NodeMouseHandler<OmniousNodeType> = useCallback((_event, node) => {
    useGraphStore.getState().selectNode(node.id);
    useUIStore.getState().setDetailPanelOpen(true);
    window.dispatchEvent(new CustomEvent('omnious:focus-node', { detail: { nodeId: node.id } }));
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

  // Disable edge animation for large graphs (> 300 nodes) to improve render perf
  const edgeAnimated = storeNodes.length <= 300;

  const globalFlags = { heatmapActive, errorFlowActive, focusActive };

  return (
    <GraphGlobalFlagsContext.Provider value={globalFlags}>
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
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
        defaultEdgeOptions={{
          type: 'animated-flow',
          animated: edgeAnimated,
          interactionWidth: 16,
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
          <ControlButton
            onClick={() => useUIStore.getState().setKeyboardShortcutsOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-4 w-4" />
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

      {/* Keyboard shortcuts dialog (portal-rendered) */}
      <KeyboardShortcutsDialog />

      {/* AI slice narrative annotation */}
      {sliceNarrative && (
        <AISliceAnnotation
          narrative={sliceNarrative}
          onFollowUp={(question) => {
            useAIStore.getState().setPrefillMessage(question);
            useUIStore.getState().setActiveDetailTab('ai');
          }}
          onDismiss={() => {
            useGraphStore.getState().setSliceNarrative(null);
          }}
        />
      )}

      {/* Layout processing overlay */}
      {isLayouting && <LayoutOverlay nodeCount={storeNodes.length} />}
    </div>
    </GraphGlobalFlagsContext.Provider>
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
