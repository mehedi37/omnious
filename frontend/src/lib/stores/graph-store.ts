import { MultiDirectedGraph } from 'graphology';
import type Sigma from 'sigma';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ZoomLevel } from '../oir/constants';
import { EDGE_COLORS, NODE_COLORS } from '../oir/constants';
import type { FlowStep, RuntimeEdge } from '../oir/trace-flow';
import type { OIREdgeType, OIRNodeType } from '../oir/types';

// ─── Sigma / Graphology attribute types ──────────────────────────────────────

/** Attributes stored on every graphology node (individual + group nodes) */
export interface SigmaNodeAttributes {
  // Sigma rendering
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
export interface SigmaEdgeAttributes {
  color: string;
  size: number;
  hidden?: boolean;
  label?: string;
  edgeType: OIREdgeType | 'runtime_call';
  isRuntime?: boolean; // edges added during trace replay
}

// ─── Module-level refs (outside Zustand to avoid immer serialization) ─────────

/** Live graphology graph instance — shared by sigma canvas and all hooks */
export const graphRef: {
  current: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> | null;
} = { current: null };

/** Live Sigma instance — shared by graph controls, search, and nav hooks */
export const sigmaRef: {
  current: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null;
} = { current: null };

/** Initialise (or return existing) graphology graph */
export function getOrCreateGraph(): MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  if (!graphRef.current) {
    graphRef.current = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  }
  return graphRef.current;
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

  // Keyboard navigation
  keyboardFocusedNodeId: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────────

  bumpGraphVersion: (counts?: { nodeCount: number; edgeCount: number }) => void;
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

  // Flow animation actions
  startFlowReplay: (runtimeEdges: RuntimeEdge[]) => void;
  setFlowStep: (step: FlowStep) => void;
  clearFlowReplay: () => void;
  getNodeFlowState: (nodeId: string) => NodeFlowState;

  // Focus + Search
  setFocusMode: (nodeId: string) => void;
  clearFocusMode: () => void;
  setNodeSearchOpen: (open: boolean) => void;
}

export const useGraphStore = create<GraphState>()(
  subscribeWithSelector(
    immer((set) => ({
      graphVersion: 0,
      nodeCount: 0,
      edgeCount: 0,

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

      updateNodePositions: (positions) => {
        const graph = graphRef.current;
        if (!graph) return;
        positions.forEach((pos, id) => {
          if (graph.hasNode(id)) {
            graph.setNodeAttribute(id, 'x', pos.x);
            graph.setNodeAttribute(id, 'y', pos.y);
          }
        });
        // Sigma auto-refreshes via graphology events; just bump version
        set((state) => {
          state.graphVersion += 1;
        });
      },

      // ── Selection ──────────────────────────────────────────────────────────

      selectNode: (nodeId) =>
        set((state) => {
          state.selectedNodeIds = new Set([nodeId]);
        }),

      deselectAll: () =>
        set((state) => {
          state.selectedNodeIds = new Set();
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
            // Show group nodes, hide individual nodes
            graph.setNodeAttribute(node, 'hidden', attrs.isIndividual);
          } else {
            // Show individual nodes, hide group nodes
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
            // Hide edges connecting individual nodes (only show group-level)
            graph.setEdgeAttribute(edge, 'hidden', !srcGroup && !tgtGroup);
          } else {
            const srcGroup = graph.getNodeAttribute(graph.source(edge), 'isGroup');
            const tgtGroup = graph.getNodeAttribute(graph.target(edge), 'isGroup');
            // Hide edges connecting group nodes (only show individual-level)
            graph.setEdgeAttribute(edge, 'hidden', srcGroup || tgtGroup);
          }
        });

        set((state) => {
          state.viewMode = mode;
          state.graphVersion += 1;
        });
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

      // ── Flow animation actions ─────────────────────────────────────────────

      startFlowReplay: (runtimeEdges) => {
        const graph = graphRef.current;
        if (graph) {
          // Add runtime edges directly to the graphology graph
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
          // Remove all runtime edges
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

      setFocusMode: (nodeId) =>
        set((state) => {
          const graph = graphRef.current;
          const connected = new Set<string>([nodeId]);
          if (graph && graph.hasNode(nodeId)) {
            graph.neighbors(nodeId).forEach((n) => connected.add(n));
          }
          state.focusedNodeId = nodeId;
          state.connectedNodeIds = connected;
          state.selectedNodeIds = new Set([nodeId]);
        }),

      clearFocusMode: () =>
        set((state) => {
          state.focusedNodeId = null;
          state.connectedNodeIds = new Set();
        }),

      setNodeSearchOpen: (open) =>
        set((state) => {
          state.nodeSearchOpen = open;
        }),
    })),
  ),
);
