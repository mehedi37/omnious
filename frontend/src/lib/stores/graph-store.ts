import type { Edge, Node } from '@xyflow/react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { FlowStep, RuntimeEdge } from '../oir/trace-flow';
import type { OIREdgeType, OIRNodeType } from '../oir/types';

// ─── React Flow node/edge data types ─────────────────────────────────────────

/** Data payload for Omnious graph nodes (stored on node.data) */
export interface OmniousNodeData {
  label: string;
  oirType: OIRNodeType;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  docComment: string | null;
  metadata: Record<string, unknown>;
  oirId: string;
  /** How this node was discovered in the current query */
  source?: 'seed' | 'traversal' | 'semantic';
  relevance?: number;
  /** Error heatmap data */
  errorCount?: number;
  errorSeverity?: string;
  /** Source code body for this node */
  codeBody?: string | null;
  /** Number of edges connected to this node (in + out) */
  connectionCount?: number;
  /** Size tier derived from type + connections */
  sizeTier?: 'large' | 'medium' | 'small';
  /** Whether this node is a graph entry point (no upstream callers) */
  isEntryPoint?: boolean;
  [key: string]: unknown;
}

/** Data payload for Omnious graph edges */
export interface OmniousEdgeData {
  edgeType: OIREdgeType | 'runtime_call';
  isRuntime?: boolean;
  /** When true, shows animated dot along the edge path */
  flowReplay?: boolean;
  [key: string]: unknown;
}

export type OmniousNode = Node<OmniousNodeData, 'omnious'>;
export type OmniousEdge = Edge<OmniousEdgeData>;

// ─── Node flow animation state ───────────────────────────────────────────────

export type NodeFlowState = 'idle' | 'active' | 'completed' | 'error';

// ─── Node sizing helpers ─────────────────────────────────────────────────────

const STRUCTURAL_TYPES: ReadonlySet<OIRNodeType> = new Set([
  'module', 'package', 'namespace', 'class', 'component', 'route',
]);

const ENTRY_POINT_TYPES: ReadonlySet<OIRNodeType> = new Set([
  'route', 'event_listener', 'middleware',
]);

/** Node dimensions per size tier (width x height) */
export const NODE_SIZE_DIMENSIONS = {
  large:  { width: 220, height: 72 },
  medium: { width: 200, height: 60 },
  small:  { width: 170, height: 48 },
} as const;

/** Compute connection counts, size tiers, and entry-point flags for nodes */
function enrichNodesWithGraphMetrics(
  nodes: OmniousNode[],
  edges: OmniousEdge[],
): OmniousNode[] {
  // Count connections per node
  const connectionCounts = new Map<string, number>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) ?? 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) ?? 0) + 1);
    hasIncoming.add(edge.target);
  }

  return nodes.map((n) => {
    const count = connectionCounts.get(n.id) ?? 0;
    const isStructural = STRUCTURAL_TYPES.has(n.data.oirType);
    const isEntryPoint = ENTRY_POINT_TYPES.has(n.data.oirType) && !hasIncoming.has(n.id);

    let sizeTier: 'large' | 'medium' | 'small';
    if (isStructural || count >= 5) {
      sizeTier = 'large';
    } else if (count <= 1) {
      sizeTier = 'small';
    } else {
      sizeTier = 'medium';
    }

    return {
      ...n,
      data: {
        ...n.data,
        connectionCount: count,
        sizeTier,
        isEntryPoint,
      },
    };
  });
}

// ─── Store types ─────────────────────────────────────────────────────────────

interface GraphState {
  // React Flow nodes and edges
  nodes: OmniousNode[];
  edges: OmniousEdge[];

  // Layout state
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
  isLayouting: boolean;
  layoutVersion: number;

  // Selection
  selectedNodeIds: Set<string>;
  neighborNodeIds: Set<string>;

  // Heatmap
  heatmapActive: boolean;
  heatmapData: Map<string, { errorCount: number; errorSeverity: string; heatLevel: string }>;

  // Node pinning
  pinnedNodeIds: Set<string>;

  // Severity filters
  severityFilters: Set<'error' | 'warning' | 'info'>;

  // Node type filtering
  nodeTypeFilters: Set<OIRNodeType>;

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

  // Search
  nodeSearchOpen: boolean;

  // Edge highlighting
  highlightedNodeId: string | null;

  // AI query context
  queryActive: boolean;
  queryExplanation: string | null;
  querySteps: string[];
  latestSliceId: string | null;
  shareNextSlice: boolean;

  // Module grouping
  moduleGroups: Array<{ label: string; color: string; nodeIds: string[] }>;

  // Error flow path
  errorFlowNodeIds: Set<string>;
  errorFlowEdgeIds: Set<string>;

  // Focus depth rings
  nodeDepthMap: Map<string, number>;

  // ── Actions ──────────────────────────────────────────────────────────────

  // Node/edge management
  setNodes: (nodes: OmniousNode[]) => void;
  setEdges: (edges: OmniousEdge[]) => void;
  setGraph: (nodes: OmniousNode[], edges: OmniousEdge[]) => void;
  clearGraph: () => void;

  // Selection
  selectNode: (nodeId: string) => void;
  deselectAll: () => void;
  toggleNodeSelection: (nodeId: string) => void;

  // Layout
  setLayoutMode: (mode: GraphState['layoutMode']) => void;
  setIsLayouting: (val: boolean) => void;
  requestLayout: () => void;

  // Heatmap
  toggleHeatmap: () => void;
  applyHeatmapData: (
    entries: Array<{
      code_node_id: string;
      error_count: number;
      severity: string;
      heat_level: string;
    }>,
  ) => void;
  clearHeatmapData: () => void;

  // Pinning
  togglePinNode: (id: string) => void;
  pinAll: () => void;
  unpinAll: () => void;

  // Severity filters
  toggleSeverityFilter: (severity: 'error' | 'warning' | 'info') => void;

  // Node type filters
  toggleNodeTypeFilter: (type: OIRNodeType) => void;
  setNodeTypeFilters: (filters: Set<OIRNodeType>) => void;

  // Flow animation
  startFlowReplay: (runtimeEdges: RuntimeEdge[]) => void;
  setFlowStep: (step: FlowStep) => void;
  clearFlowReplay: () => void;
  getNodeFlowState: (nodeId: string) => NodeFlowState;

  // Focus + Search
  setFocusMode: (nodeId: string) => void;
  clearFocusMode: () => void;
  setNodeSearchOpen: (open: boolean) => void;
  highlightConnectedEdges: (nodeId: string | null) => void;

  // AI query state
  setQueryActive: (active: boolean) => void;
  setQueryResult: (explanation: string, steps: string[]) => void;
  setLatestSliceId: (sliceId: string | null) => void;
  setShareNextSlice: (shared: boolean) => void;
  clearQueryResult: () => void;

  // Module grouping
  setModuleGroups: (groups: Array<{ label: string; color: string; nodeIds: string[] }>) => void;
  clearModuleGroups: () => void;

  // Error flow path
  traceErrorPath: (errorNodeId: string) => void;
  clearErrorPath: () => void;
}

export const useGraphStore = create<GraphState>()(
  subscribeWithSelector(
    immer((set) => ({
      nodes: [],
      edges: [],

      layoutMode: 'layered-tb',
      isLayouting: false,
      layoutVersion: 0,

      selectedNodeIds: new Set<string>(),
      neighborNodeIds: new Set<string>(),

      heatmapActive: false,
      heatmapData: new Map(),

      pinnedNodeIds: new Set<string>(),

      severityFilters: new Set<'error' | 'warning' | 'info'>(['error']),

      nodeTypeFilters: new Set<OIRNodeType>(),

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

      queryActive: false,
      queryExplanation: null,
      querySteps: [],
      latestSliceId: null,
      shareNextSlice: false,

      moduleGroups: [],

      errorFlowNodeIds: new Set<string>(),
      errorFlowEdgeIds: new Set<string>(),

      nodeDepthMap: new Map<string, number>(),

      // ── Node/edge management ───────────────────────────────────────────

      setNodes: (nodes) =>
        set((state) => {
          state.nodes = nodes;
        }),

      setEdges: (edges) =>
        set((state) => {
          state.edges = edges;
        }),

      setGraph: (nodes, edges) =>
        set((state) => {
          state.nodes = enrichNodesWithGraphMetrics(nodes, edges);
          state.edges = edges;
          state.selectedNodeIds = new Set();
          state.neighborNodeIds = new Set();
          state.focusedNodeId = null;
          state.connectedNodeIds = new Set();
          state.highlightedNodeId = null;
        }),

      clearGraph: () =>
        set((state) => {
          state.nodes = [];
          state.edges = [];
          state.selectedNodeIds = new Set();
          state.neighborNodeIds = new Set();
          state.focusedNodeId = null;
          state.connectedNodeIds = new Set();
          state.highlightedNodeId = null;
          state.queryExplanation = null;
          state.querySteps = [];
          state.latestSliceId = null;
        }),

      // ── Selection ──────────────────────────────────────────────────────

      selectNode: (nodeId) =>
        set((state) => {
          state.selectedNodeIds = new Set([nodeId]);
          // Compute neighbor nodes from edges
          const neighbors = new Set<string>();
          for (const edge of state.edges) {
            if (edge.source === nodeId) neighbors.add(edge.target);
            if (edge.target === nodeId) neighbors.add(edge.source);
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

      // ── Layout ─────────────────────────────────────────────────────────

      setLayoutMode: (mode) =>
        set((state) => {
          state.layoutMode = mode;
        }),

      setIsLayouting: (val) =>
        set((state) => {
          state.isLayouting = val;
        }),

      requestLayout: () =>
        set((state) => {
          state.layoutVersion += 1;
        }),

      // ── Heatmap ────────────────────────────────────────────────────────

      toggleHeatmap: () =>
        set((state) => {
          state.heatmapActive = !state.heatmapActive;
        }),
      applyHeatmapData: (entries) =>
        set((state) => {
          const newMap = new Map<
            string,
            { errorCount: number; errorSeverity: string; heatLevel: string }
          >();
          for (const e of entries) {
            newMap.set(e.code_node_id, {
              errorCount: Number(e.error_count),
              errorSeverity: e.severity,
              heatLevel: e.heat_level,
            });
          }
          state.heatmapData = newMap;
          // Merge errorCount / errorSeverity into node.data so filtering and glow work
          state.nodes = state.nodes.map((n: OmniousNode) => {
            const heat = newMap.get(n.id);
            if (!heat) return n;
            return {
              ...n,
              data: {
                ...n.data,
                errorCount: heat.errorCount,
                errorSeverity: heat.errorSeverity,
              },
            };
          });
        }),

      clearHeatmapData: () =>
        set((state) => {
          state.heatmapData = new Map();
          // Clear error fields from nodes
          state.nodes = state.nodes.map((n: OmniousNode) => ({
            ...n,
            data: { ...n.data, errorCount: undefined, errorSeverity: undefined },
          }));
        }),
      // ── Pinning ───────────────────────────────────────────────────────

      togglePinNode: (id) =>
        set((state) => {
          const next = new Set(state.pinnedNodeIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          state.pinnedNodeIds = next;
        }),

      pinAll: () =>
        set((state) => {
          state.pinnedNodeIds = new Set(state.nodes.map((n: OmniousNode) => n.id));
        }),

      unpinAll: () =>
        set((state) => {
          state.pinnedNodeIds = new Set();
        }),

      // ── Severity filters ───────────────────────────────────────────────

      toggleSeverityFilter: (severity) =>
        set((state) => {
          const next = new Set(state.severityFilters);
          if (next.has(severity)) next.delete(severity);
          else next.add(severity);
          state.severityFilters = next;
        }),

      // ── Node type filters ──────────────────────────────────────────────

      toggleNodeTypeFilter: (type) =>
        set((state) => {
          const next = new Set(state.nodeTypeFilters);
          if (next.has(type)) next.delete(type);
          else next.add(type);
          state.nodeTypeFilters = next;
        }),

      setNodeTypeFilters: (filters) =>
        set((state) => {
          state.nodeTypeFilters = filters;
        }),

      // ── Flow animation ─────────────────────────────────────────────────

      startFlowReplay: (runtimeEdges) => {
        set((state) => {
          // Add runtime edges to the edge array
          for (const re of runtimeEdges) {
            const exists = state.edges.some((e: OmniousEdge) => e.id === re.id);
            if (!exists) {
              state.edges.push({
                id: re.id,
                source: re.sourceNodeId,
                target: re.targetNodeId,
                type: 'animated-flow',
                data: { edgeType: 'runtime_call', isRuntime: true, flowReplay: true },
              });
            }
          }
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
          if (step.edgeId) state.activeEdgeIds.add(step.edgeId);
          if (step.status === 'error' && step.nodeId) state.errorNodeIds.add(step.nodeId);
          state.callStack = state.callStack.slice(0, step.depth);
          state.callStack.push(step);
        }),

      clearFlowReplay: () =>
        set((state) => {
          // Remove runtime edges
          state.edges = state.edges.filter((e: OmniousEdge) => !e.data?.isRuntime);
          state.flowMode = 'static';
          state.activeFlowStep = null;
          state.activeNodeId = null;
          state.activeEdgeIds = new Set();
          state.completedNodeIds = new Set();
          state.errorNodeIds = new Set();
          state.callStack = [];
        }),

      getNodeFlowState: (nodeId) => {
        const s = useGraphStore.getState();
        if (s.flowMode !== 'replay') return 'idle';
        if (s.activeNodeId === nodeId) return 'active';
        if (s.errorNodeIds.has(nodeId)) return 'error';
        if (s.completedNodeIds.has(nodeId)) return 'completed';
        return 'idle';
      },

      // ── Focus + Search ─────────────────────────────────────────────────

      setFocusMode: (nodeId) =>
        set((state) => {
          // Collect 2-hop neighbors from edges + track depth
          const connected = new Set<string>([nodeId]);
          const depthMap = new Map<string, number>([[nodeId, 0]]);
          const hop1 = new Set<string>();

          for (const edge of state.edges) {
            if (edge.source === nodeId) {
              connected.add(edge.target);
              hop1.add(edge.target);
              depthMap.set(edge.target, 1);
            }
            if (edge.target === nodeId) {
              connected.add(edge.source);
              hop1.add(edge.source);
              depthMap.set(edge.source, 1);
            }
          }

          // 2nd hop
          for (const n1 of hop1) {
            if (connected.size >= 50) break;
            for (const edge of state.edges) {
              if (connected.size >= 50) break;
              if (edge.source === n1 && !connected.has(edge.target)) {
                connected.add(edge.target);
                depthMap.set(edge.target, 2);
              }
              if (edge.target === n1 && !connected.has(edge.source)) {
                connected.add(edge.source);
                depthMap.set(edge.source, 2);
              }
            }
          }

          state.focusedNodeId = nodeId;
          state.connectedNodeIds = connected;
          state.nodeDepthMap = depthMap;
          state.selectedNodeIds = new Set([nodeId]);
          state.neighborNodeIds = hop1;
        }),

      clearFocusMode: () =>
        set((state) => {
          state.focusedNodeId = null;
          state.connectedNodeIds = new Set();
          state.nodeDepthMap = new Map();
          state.selectedNodeIds = new Set();
          state.neighborNodeIds = new Set();
          state.highlightedNodeId = null;
        }),

      setNodeSearchOpen: (open) =>
        set((state) => {
          state.nodeSearchOpen = open;
        }),

      highlightConnectedEdges: (nodeId) =>
        set((state) => {
          state.highlightedNodeId = nodeId;
        }),

      // ── AI query state ─────────────────────────────────────────────────

      setQueryActive: (active) =>
        set((state) => {
          state.queryActive = active;
        }),

      setQueryResult: (explanation, steps) =>
        set((state) => {
          state.queryExplanation = explanation;
          state.querySteps = steps;
          state.queryActive = false;
        }),

      setLatestSliceId: (sliceId) =>
        set((state) => {
          state.latestSliceId = sliceId;
        }),

      setShareNextSlice: (shared) =>
        set((state) => {
          state.shareNextSlice = shared;
        }),

      clearQueryResult: () =>
        set((state) => {
          state.queryExplanation = null;
          state.querySteps = [];
          state.latestSliceId = null;
        }),

      setModuleGroups: (groups) =>
        set((state) => {
          state.moduleGroups = groups;
        }),

      clearModuleGroups: () =>
        set((state) => {
          state.moduleGroups = [];
        }),

      // ── Error flow path ─────────────────────────────────────────────────

      traceErrorPath: (errorNodeId) =>
        set((state) => {
          // BFS upstream from errorNodeId following incoming edges
          const visited = new Set<string>([errorNodeId]);
          const pathEdges = new Set<string>();
          const queue = [errorNodeId];

          // Build a reverse adjacency list (target → edges)
          const incomingEdges = new Map<string, OmniousEdge[]>();
          for (const edge of state.edges) {
            const list = incomingEdges.get(edge.target);
            if (list) list.push(edge);
            else incomingEdges.set(edge.target, [edge]);
          }

          // BFS up to 6 hops upstream
          let depth = 0;
          while (queue.length > 0 && depth < 6) {
            const next: string[] = [];
            for (const nodeId of queue) {
              for (const edge of incomingEdges.get(nodeId) ?? []) {
                pathEdges.add(edge.id);
                if (!visited.has(edge.source)) {
                  visited.add(edge.source);
                  next.push(edge.source);
                }
              }
            }
            queue.length = 0;
            queue.push(...next);
            depth++;
          }

          state.errorFlowNodeIds = visited;
          state.errorFlowEdgeIds = pathEdges;
        }),

      clearErrorPath: () =>
        set((state) => {
          state.errorFlowNodeIds = new Set();
          state.errorFlowEdgeIds = new Set();
        }),
    })),
  ),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert backend subgraph nodes to React Flow nodes */
export function toReactFlowNodes(
  subgraphNodes: Array<{
    id: string;
    oir_id: string;
    type: string;
    name: string;
    file_path: string;
    line_start: number | null;
    line_end: number | null;
    signature: string | null;
    doc_comment: string | null;
    metadata: Record<string, unknown> | null;
    source?: 'seed' | 'traversal' | 'semantic';
    relevance?: number;
    code_body?: string | null;
  }>,
): OmniousNode[] {
  return subgraphNodes.map((n, i) => ({
    id: n.id,
    type: 'omnious',
    // Temporary position — will be overridden by ELK layout
    position: { x: (i % 6) * 300, y: Math.floor(i / 6) * 120 },
    data: {
      label: n.name,
      oirType: n.type as OIRNodeType,
      filePath: n.file_path,
      lineStart: n.line_start,
      lineEnd: n.line_end,
      signature: n.signature,
      docComment: n.doc_comment,
      metadata: n.metadata ?? {},
      oirId: n.oir_id,
      source: n.source,
      relevance: n.relevance,
      codeBody: n.code_body ?? null,
    },
  }));
}

/** Convert backend subgraph edges to React Flow edges */
export function toReactFlowEdges(
  subgraphEdges: Array<{
    id: string;
    source_node_id: string;
    target_node_id: string;
    type: string;
    metadata: Record<string, unknown> | null;
  }>,
): OmniousEdge[] {
  return subgraphEdges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    type: 'animated-flow',
    data: {
      edgeType: e.type as OIREdgeType,
    },
  }));
}
