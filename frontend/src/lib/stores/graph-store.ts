import { MultiDirectedGraph } from 'graphology';
import type { Edge, Node } from '@xyflow/react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ZoomLevel } from '../oir/constants';
import { EDGE_COLORS, NODE_COLORS } from '../oir/constants';
import type { FlowStep, RuntimeEdge } from '../oir/trace-flow';
import type { OIREdgeType, OIRNodeType } from '../oir/types';

// ─── Graphology attribute types ──────────────────────────────────────────────

/** Attributes stored on every graphology node (individual + group nodes) */
export interface GraphNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  hidden?: boolean;

  // OIR data (individual nodes)
  oirType: OIRNodeType | null;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  docComment: string | null;
  metadata: Record<string, unknown>;
  errorCount?: number;
  errorSeverity?: string;

  // Group node data
  isGroup: boolean;
  directory?: string;
  childCount?: number;
  childNodeIds?: string[];
  typeBreakdown?: Record<string, number>;
  dominantType?: string;

  /** Whether this node belongs to the individual (non-grouped) graph */
  isIndividual: boolean;
}

/** Attributes stored on every graphology edge */
export interface GraphEdgeAttributes {
  color: string;
  size: number;
  hidden?: boolean;
  label?: string;
  edgeType: OIREdgeType | 'runtime_call';
  isRuntime?: boolean; // edges added during trace replay
}

// ─── React Flow node/edge data payloads ──────────────────────────────────────

export interface RFNodeData extends Record<string, unknown> {
  label: string;
  oirType: OIRNodeType | null;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  docComment: string | null;
  metadata: Record<string, unknown>;
  errorCount?: number;
  errorSeverity?: string;
  isGroup: boolean;
  directory?: string;
  childCount?: number;
  childNodeIds?: string[];
  typeBreakdown?: Record<string, number>;
  dominantType?: string;
  isIndividual: boolean;
  color: string;
}

export interface RFEdgeData extends Record<string, unknown> {
  edgeType: OIREdgeType | 'runtime_call';
  isRuntime?: boolean;
  routePoints?: Array<{ x: number; y: number }>;
}

// ─── Module-level refs (outside Zustand to avoid immer serialization) ─────────

/** Live graphology graph instance — shared by flow canvas and all hooks */
export const graphRef: {
  current: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes> | null;
} = { current: null };

/** Initialise (or return existing) graphology graph */
export function getOrCreateGraph(): MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes> {
  if (!graphRef.current) {
    graphRef.current = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>();
  }
  return graphRef.current;
}

// ─── Graphology → React Flow sync ────────────────────────────────────────────

/**
 * Read the graphology graph and produce React Flow node/edge arrays.
 * Applies view-mode visibility and node-type filtering.
 */
export function buildRFNodesAndEdges(
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  nodeTypeFilters: Set<OIRNodeType>,
  focusedNodeId: string | null = null,
  connectedNodeIds: Set<string> = new Set(),
  selectedNodeIds: Set<string> = new Set(),
  edgeRoutes: Map<string, Array<{ x: number; y: number }>> = new Map(),
): { rfNodes: Node<RFNodeData>[]; rfEdges: Edge<RFEdgeData>[] } {
  const rfNodes: Node<RFNodeData>[] = [];
  const rfEdges: Edge<RFEdgeData>[] = [];
  const isFocusMode = focusedNodeId !== null;

  graph.forEachNode((id, attrs) => {
    if (attrs.hidden) return;
    // Apply node type filter (individual nodes only — groups always pass)
    if (!attrs.isGroup && attrs.oirType && nodeTypeFilters.size > 0 && !nodeTypeFilters.has(attrs.oirType)) return;

    const isConnected = !isFocusMode || connectedNodeIds.has(id);

    // Exclusive focus mode: completely hide non-connected nodes
    if (isFocusMode && !isConnected) return;

    rfNodes.push({
      id,
      type: attrs.isGroup ? 'group' : 'code',
      position: { x: attrs.x, y: attrs.y },
      zIndex: 1,
      draggable: isConnected,
      selectable: isConnected,
      selected: selectedNodeIds.has(id),
      data: {
        label: attrs.label,
        oirType: attrs.oirType,
        filePath: attrs.filePath,
        lineStart: attrs.lineStart,
        lineEnd: attrs.lineEnd,
        signature: attrs.signature,
        docComment: attrs.docComment,
        metadata: attrs.metadata,
        errorCount: attrs.errorCount,
        errorSeverity: attrs.errorSeverity,
        isGroup: attrs.isGroup,
        directory: attrs.directory,
        childCount: attrs.childCount,
        childNodeIds: attrs.childNodeIds,
        typeBreakdown: attrs.typeBreakdown,
        dominantType: attrs.dominantType,
        isIndividual: attrs.isIndividual,
        color: attrs.color,
      },
    });
  });

  const visibleNodeIds = new Set(rfNodes.map((n) => n.id));

  graph.forEachEdge((edgeId, attrs, source, target) => {
    if (attrs.hidden) return;
    if (!visibleNodeIds.has(source) || !visibleNodeIds.has(target)) return;

    rfEdges.push({
      id: edgeId,
      source,
      target,
      type: attrs.isRuntime ? 'animated' : 'routed',
      animated: !!attrs.isRuntime,
      zIndex: 0,
      style: { stroke: attrs.color, strokeWidth: attrs.size },
      data: {
        edgeType: attrs.edgeType,
        isRuntime: attrs.isRuntime,
        routePoints: edgeRoutes.get(edgeId),
      },
    });
  });

  return { rfNodes, rfEdges };
}

// ─── Node animation state ─────────────────────────────────────────────────────

export type NodeFlowState = 'idle' | 'active' | 'completed' | 'error';
export type ViewMode = 'grouped' | 'individual';

// ─── Zustand store ────────────────────────────────────────────────────────────

interface GraphState {
  // Reactive graph counters (increment to trigger re-renders)
  graphVersion: number;
  nodeCount: number;
  edgeCount: number;

  // React Flow arrays (derived from graphology via syncFromGraphology)
  rfNodes: Node<RFNodeData>[];
  rfEdges: Edge<RFEdgeData>[];

  // Node type filtering
  nodeTypeFilters: Set<OIRNodeType>;

  selectedNodeIds: Set<string>;
  zoomLevel: ZoomLevel;
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
  heatmapActive: boolean;
  isLayouting: boolean;
  layoutVersion: number;

  // View mode
  viewMode: ViewMode;
  expandedGroupIds: Set<string>;

  // Flow animation state
  flowMode: 'static' | 'replay';
  activeFlowStep: FlowStep | null;
  activeNodeId: string | null;
  activeEdgeIds: Set<string>;
  completedNodeIds: Set<string>;
  errorNodeIds: Set<string>;
  callStack: FlowStep[];

  // Focus mode
  focusedNodeId: string | null;
  connectedNodeIds: Set<string>;
  nodeSearchOpen: boolean;

  // Edge highlighting (click-to-highlight connected edges)
  highlightedNodeId: string | null;

  // Neighbor node highlight (purple ring on nodes connected to selected)
  neighborNodeIds: Set<string>;

  // ELK-computed edge routes (avoid node overlap)
  edgeRoutes: Map<string, Array<{ x: number; y: number }>>;

  // Node position locking
  nodesLocked: boolean;

  // Keyboard navigation
  keyboardFocusedNodeId: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────────

  bumpGraphVersion: (counts?: { nodeCount: number; edgeCount: number }) => void;
  syncFromGraphology: () => void;
  updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;
  selectNode: (nodeId: string) => void;
  deselectAll: () => void;
  toggleNodeSelection: (nodeId: string) => void;
  selectAllVisible: () => void;
  setZoomLevel: (level: ZoomLevel) => void;
  setLayoutMode: (mode: GraphState['layoutMode']) => void;
  toggleHeatmap: () => void;
  setIsLayouting: (val: boolean) => void;
  requestLayout: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupExpanded: (groupId: string) => void;
  setKeyboardFocusedNode: (nodeId: string | null) => void;
  toggleNodeTypeFilter: (type: OIRNodeType) => void;
  setNodeTypeFilters: (filters: Set<OIRNodeType>) => void;

  // Flow animation actions
  startFlowReplay: (runtimeEdges: RuntimeEdge[]) => void;
  setFlowStep: (step: FlowStep) => void;
  clearFlowReplay: () => void;
  getNodeFlowState: (nodeId: string) => NodeFlowState;

  // Focus + Search
  setFocusMode: (nodeId: string) => void;
  clearFocusMode: () => void;
  setNodeSearchOpen: (open: boolean) => void;
  highlightConnectedEdges: (nodeId: string | null) => void;
  setEdgeRoutes: (routes: Map<string, Array<{ x: number; y: number }>>) => void;
  toggleNodesLocked: () => void;
}

export const useGraphStore = create<GraphState>()(
  subscribeWithSelector(
    immer((set) => ({
      graphVersion: 0,
      nodeCount: 0,
      edgeCount: 0,

      rfNodes: [],
      rfEdges: [],
      nodeTypeFilters: new Set<OIRNodeType>(),

      selectedNodeIds: new Set<string>(),
      zoomLevel: 'function' as ZoomLevel,
      layoutMode: 'layered-tb',
      heatmapActive: false,
      isLayouting: false,
      layoutVersion: 0,

      viewMode: 'grouped' as ViewMode,
      expandedGroupIds: new Set<string>(),

      flowMode: 'static',
      activeFlowStep: null,
      activeNodeId: null,
      activeEdgeIds: new Set<string>(),
      completedNodeIds: new Set<string>(),
      errorNodeIds: new Set<string>(),
      callStack: [],

      focusedNodeId: null,
      connectedNodeIds: new Set<string>(),
      nodeSearchOpen: false,

      highlightedNodeId: null,

      neighborNodeIds: new Set<string>(),

      edgeRoutes: new Map<string, Array<{ x: number; y: number }>>(),

      nodesLocked: false,

      keyboardFocusedNodeId: null,

      // ── Graph version / counters ────────────────────────────────────────────

      bumpGraphVersion: (counts) =>
        set((state) => {
          state.graphVersion += 1;
          if (counts) {
            state.nodeCount = counts.nodeCount;
            state.edgeCount = counts.edgeCount;
          } else {
            const g = graphRef.current;
            if (g) {
              state.nodeCount = g.order;
              state.edgeCount = g.size;
            }
          }
        }),

      // ── Sync graphology → React Flow arrays ────────────────────────────────

      syncFromGraphology: () => {
        const graph = graphRef.current;
        if (!graph) return;
        const s = useGraphStore.getState();
        const { rfNodes, rfEdges } = buildRFNodesAndEdges(graph, s.nodeTypeFilters, s.focusedNodeId, s.connectedNodeIds, s.selectedNodeIds, s.edgeRoutes);
        // Apply node position lock if active
        if (s.nodesLocked) {
          for (const node of rfNodes) { node.draggable = false; }
        }
        set((state) => {
          state.rfNodes = rfNodes;
          state.rfEdges = rfEdges;
          state.graphVersion += 1;
          state.nodeCount = graph.order;
          state.edgeCount = graph.size;
        });
      },

      updateNodePositions: (positions) => {
        const graph = graphRef.current;
        if (!graph) return;
        positions.forEach((pos, id) => {
          if (graph.hasNode(id)) {
            graph.setNodeAttribute(id, 'x', pos.x);
            graph.setNodeAttribute(id, 'y', pos.y);
          }
        });
        // Rebuild React Flow arrays with updated positions
        const s = useGraphStore.getState();
        const { rfNodes, rfEdges } = buildRFNodesAndEdges(graph, s.nodeTypeFilters, s.focusedNodeId, s.connectedNodeIds, s.selectedNodeIds, s.edgeRoutes);
        set((state) => {
          state.rfNodes = rfNodes;
          state.rfEdges = rfEdges;
          state.graphVersion += 1;
        });
      },

      // ── Selection ──────────────────────────────────────────────────────────

      selectNode: (nodeId) =>
        set((state) => {
          state.selectedNodeIds = new Set([nodeId]);
          // Highlight neighbor nodes in purple
          const graph = graphRef.current;
          const neighbors = new Set<string>();
          if (graph && graph.hasNode(nodeId)) {
            graph.neighbors(nodeId).forEach((n) => neighbors.add(n));
          }
          state.neighborNodeIds = neighbors;
        }),

      deselectAll: () =>
        set((state) => {
          state.selectedNodeIds = new Set();
          state.neighborNodeIds = new Set();
        }),

      toggleNodeSelection: (nodeId) =>
        set((state) => {
          const next = new Set(state.selectedNodeIds);
          if (next.has(nodeId)) next.delete(nodeId);
          else next.add(nodeId);
          state.selectedNodeIds = next;
        }),

      selectAllVisible: () =>
        set((state) => {
          const graph = graphRef.current;
          if (!graph) return;
          const visible = graph.nodes().filter((n) => !graph.getNodeAttribute(n, 'hidden'));
          state.selectedNodeIds = new Set(visible);
        }),

      // ── Graph settings ─────────────────────────────────────────────────────

      setZoomLevel: (level) =>
        set((state) => {
          state.zoomLevel = level;
        }),

      setLayoutMode: (mode) =>
        set((state) => {
          state.layoutMode = mode;
        }),

      toggleHeatmap: () =>
        set((state) => {
          state.heatmapActive = !state.heatmapActive;
        }),

      setIsLayouting: (val) =>
        set((state) => {
          state.isLayouting = val;
        }),

      requestLayout: () =>
        set((state) => {
          state.layoutVersion += 1;
        }),

      // ── View mode ──────────────────────────────────────────────────────────

      setViewMode: (mode) => {
        const graph = graphRef.current;
        if (!graph) return;

        // Show/hide individual vs group nodes
        graph.nodes().forEach((node) => {
          const attrs = graph.getNodeAttributes(node);
          if (mode === 'grouped') {
            graph.setNodeAttribute(node, 'hidden', attrs.isIndividual);
          } else {
            graph.setNodeAttribute(node, 'hidden', attrs.isGroup);
          }
        });
        // Hide intra-group edges in grouped mode, show in individual
        graph.edges().forEach((edge) => {
          if (graph.getEdgeAttribute(edge, 'isRuntime')) return;
          if (mode === 'grouped') {
            const src = graph.source(edge);
            const tgt = graph.target(edge);
            const srcGroup = graph.getNodeAttribute(src, 'isGroup');
            const tgtGroup = graph.getNodeAttribute(tgt, 'isGroup');
            graph.setEdgeAttribute(edge, 'hidden', !srcGroup && !tgtGroup);
          } else {
            const srcGroup = graph.getNodeAttribute(graph.source(edge), 'isGroup');
            const tgtGroup = graph.getNodeAttribute(graph.target(edge), 'isGroup');
            graph.setEdgeAttribute(edge, 'hidden', srcGroup || tgtGroup);
          }
        });

        set((state) => {
          state.viewMode = mode;
        });

        // Sync React Flow arrays after visibility change
        useGraphStore.getState().syncFromGraphology();
      },

      toggleGroupExpanded: (groupId) =>
        set((state) => {
          const next = new Set(state.expandedGroupIds);
          if (next.has(groupId)) next.delete(groupId);
          else next.add(groupId);
          state.expandedGroupIds = next;
        }),

      setKeyboardFocusedNode: (nodeId) =>
        set((state) => {
          state.keyboardFocusedNodeId = nodeId;
        }),

      // ── Node type filters ──────────────────────────────────────────────────

      toggleNodeTypeFilter: (type) => {
        const next = new Set(useGraphStore.getState().nodeTypeFilters);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        // Rebuild RF arrays with new filter
        const graph = graphRef.current;
        if (graph) {
          const s = useGraphStore.getState();
          const { rfNodes, rfEdges } = buildRFNodesAndEdges(graph, next, s.focusedNodeId, s.connectedNodeIds, s.selectedNodeIds);
          set((state) => {
            state.nodeTypeFilters = next;
            state.rfNodes = rfNodes;
            state.rfEdges = rfEdges;
          });
        } else {
          set((state) => { state.nodeTypeFilters = next; });
        }
      },

      setNodeTypeFilters: (filters) => {
        const graph = graphRef.current;
        if (graph) {
          const s = useGraphStore.getState();
          const { rfNodes, rfEdges } = buildRFNodesAndEdges(graph, filters, s.focusedNodeId, s.connectedNodeIds, s.selectedNodeIds);
          set((state) => {
            state.nodeTypeFilters = filters;
            state.rfNodes = rfNodes;
            state.rfEdges = rfEdges;
          });
        } else {
          set((state) => { state.nodeTypeFilters = filters; });
        }
      },

      // ── Flow animation actions ─────────────────────────────────────────────

      startFlowReplay: (runtimeEdges) => {
        const graph = graphRef.current;
        if (graph) {
          for (const re of runtimeEdges) {
            if (
              graph.hasNode(re.sourceNodeId) &&
              graph.hasNode(re.targetNodeId) &&
              !graph.hasEdge(re.id)
            ) {
              graph.addEdgeWithKey(re.id, re.sourceNodeId, re.targetNodeId, {
                color: 'oklch(0.7 0.2 195)',
                size: 2,
                edgeType: 'runtime_call',
                isRuntime: true,
              });
            }
          }
        }
        set((state) => {
          state.flowMode = 'replay';
          state.activeFlowStep = null;
          state.activeNodeId = null;
          state.activeEdgeIds = new Set();
          state.completedNodeIds = new Set();
          state.errorNodeIds = new Set();
          state.callStack = [];
        });
        useGraphStore.getState().syncFromGraphology();
      },

      setFlowStep: (step) =>
        set((state) => {
          const prev = state.activeFlowStep;

          if (prev?.nodeId) {
            if (prev.status === 'error') {
              state.errorNodeIds.add(prev.nodeId);
            } else {
              state.completedNodeIds.add(prev.nodeId);
            }
          }

          state.activeFlowStep = step;
          state.activeNodeId = step.nodeId;

          state.activeEdgeIds = new Set<string>();
          if (step.edgeId) {
            state.activeEdgeIds.add(step.edgeId);
          }

          if (step.status === 'error' && step.nodeId) {
            state.errorNodeIds.add(step.nodeId);
          }

          state.callStack = state.callStack.slice(0, step.depth);
          state.callStack.push(step);
        }),

      clearFlowReplay: () => {
        const graph = graphRef.current;
        if (graph) {
          graph.edges().forEach((edge) => {
            if (graph.getEdgeAttribute(edge, 'isRuntime')) {
              graph.dropEdge(edge);
            }
          });
        }
        set((state) => {
          state.flowMode = 'static';
          state.activeFlowStep = null;
          state.activeNodeId = null;
          state.activeEdgeIds = new Set();
          state.completedNodeIds = new Set();
          state.errorNodeIds = new Set();
          state.callStack = [];
        });
        useGraphStore.getState().syncFromGraphology();
      },

      getNodeFlowState: (nodeId) => {
        const s = useGraphStore.getState();
        if (s.flowMode !== 'replay') return 'idle';
        if (s.activeNodeId === nodeId) return 'active';
        if (s.errorNodeIds.has(nodeId)) return 'error';
        if (s.completedNodeIds.has(nodeId)) return 'completed';
        return 'idle';
      },

      // ── Focus + Search ─────────────────────────────────────────────────────

      setFocusMode: (nodeId) => {
        const graph = graphRef.current;
        const connected = new Set<string>([nodeId]);
        if (graph && graph.hasNode(nodeId)) {
          graph.neighbors(nodeId).forEach((n) => connected.add(n));
        }
        set((state) => {
          state.focusedNodeId = nodeId;
          state.connectedNodeIds = connected;
          state.selectedNodeIds = new Set([nodeId]);
          state.neighborNodeIds = new Set(); // clear — focus mode handles this differently
        });
        useGraphStore.getState().syncFromGraphology();
        // Auto-fit connected nodes into viewport
        window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
      },

      clearFocusMode: () => {
        set((state) => {
          state.focusedNodeId = null;
          state.connectedNodeIds = new Set();
        });
        useGraphStore.getState().syncFromGraphology();
        // Reset viewport to show all visible nodes
        window.dispatchEvent(new CustomEvent('omnious:focus-clear'));
      },

      setNodeSearchOpen: (open) =>
        set((state) => {
          state.nodeSearchOpen = open;
        }),

      // ── Edge highlighting ──────────────────────────────────────────────────

      highlightConnectedEdges: (nodeId) => {
        set((state) => {
          state.highlightedNodeId = nodeId;
          // Update edge z-index and stroke for highlighted edges
          const AMBER_STROKE = 'oklch(0.75 0.18 75)'; // amber/gold
          for (const edge of state.rfEdges) {
            if (nodeId && (edge.source === nodeId || edge.target === nodeId)) {
              edge.zIndex = 10;
              edge.style = { ...edge.style, stroke: AMBER_STROKE, strokeWidth: 2.5, opacity: 1 };
            } else {
              edge.zIndex = 0;
              // Restore original color from graphology; dim non-connected edges when highlighting
              const graph = graphRef.current;
              if (graph && graph.hasEdge(edge.id)) {
                const attrs = graph.getEdgeAttributes(edge.id);
                edge.style = {
                  ...edge.style,
                  stroke: attrs.color,
                  strokeWidth: attrs.size,
                  opacity: nodeId ? 0.1 : 0.45,
                };
              }
            }
          }
        });
      },

      // ── Edge routes ────────────────────────────────────────────────────────

      setEdgeRoutes: (routes) =>
        set((state) => {
          state.edgeRoutes = routes;
        }),

      // ── Node position lock ─────────────────────────────────────────────────

      toggleNodesLocked: () => {
        set((state) => {
          state.nodesLocked = !state.nodesLocked;
          // Update draggable on all RF nodes
          const locked = state.nodesLocked;
          for (const node of state.rfNodes) {
            node.draggable = !locked;
          }
        });
      },
    })),
  ),
);
