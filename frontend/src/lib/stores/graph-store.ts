import type { Edge, EdgeChange, Node, NodeChange } from '@xyflow/react';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ZoomLevel } from '../oir/constants';
import type { FlowStep, RuntimeEdge } from '../oir/trace-flow';
import type { GraphEdgeData, GraphNodeData } from '../oir/transforms';

/** Node animation state during trace replay */
export type NodeFlowState = 'idle' | 'active' | 'completed' | 'error';

interface GraphState {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
  selectedNodeIds: Set<string>;
  zoomLevel: ZoomLevel;
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
  hiddenNodeIds: Set<string>;
  heatmapActive: boolean;
  isLayouting: boolean;

  // ── Flow animation state ──
  flowMode: 'static' | 'replay';
  activeFlowStep: FlowStep | null;
  activeNodeId: string | null;
  activeEdgeIds: Set<string>;
  completedNodeIds: Set<string>;
  errorNodeIds: Set<string>;
  runtimeEdges: Edge<GraphEdgeData>[];
  callStack: FlowStep[];

  // ── Focus mode ──
  focusedNodeId: string | null;
  connectedNodeIds: Set<string>;
  nodeSearchOpen: boolean;

  // Actions
  setNodes: (nodes: Node<GraphNodeData>[]) => void;
  setEdges: (edges: Edge<GraphEdgeData>[]) => void;
  applyNodeChanges: (changes: NodeChange[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;
  selectNode: (nodeId: string) => void;
  deselectAll: () => void;
  toggleNodeSelection: (nodeId: string) => void;
  setZoomLevel: (level: ZoomLevel) => void;
  setLayoutMode: (mode: GraphState['layoutMode']) => void;
  toggleHeatmap: () => void;
  setIsLayouting: (val: boolean) => void;
  hideNodes: (nodeIds: string[]) => void;
  showAllNodes: () => void;
  updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;

  // ── Flow animation actions ──
  startFlowReplay: (runtimeEdges: RuntimeEdge[]) => void;
  setFlowStep: (step: FlowStep) => void;
  clearFlowReplay: () => void;
  getNodeFlowState: (nodeId: string) => NodeFlowState;

  // ── Focus + Search ──
  setFocusMode: (nodeId: string) => void;
  clearFocusMode: () => void;
  setNodeSearchOpen: (open: boolean) => void;
}

export const useGraphStore = create<GraphState>()(
  subscribeWithSelector(
    immer((set) => ({
      nodes: [],
      edges: [],
      selectedNodeIds: new Set<string>(),
      zoomLevel: 'function' as ZoomLevel,
      layoutMode: 'layered-tb',
      hiddenNodeIds: new Set<string>(),
      heatmapActive: false,
      isLayouting: false,

      // ── Flow animation state ──
      flowMode: 'static',
      activeFlowStep: null,
      activeNodeId: null,
      activeEdgeIds: new Set<string>(),
      completedNodeIds: new Set<string>(),
      errorNodeIds: new Set<string>(),
      runtimeEdges: [],
      callStack: [],

      // ── Focus mode ──
      focusedNodeId: null,
      connectedNodeIds: new Set<string>(),
      nodeSearchOpen: false,

      setNodes: (nodes) =>
        set((state) => {
          state.nodes = nodes;
        }),

      setEdges: (edges) =>
        set((state) => {
          state.edges = edges;
        }),

      applyNodeChanges: (changes) =>
        set((state) => {
          state.nodes = applyNodeChanges(changes, state.nodes) as Node<GraphNodeData>[];
        }),

      applyEdgeChanges: (changes) =>
        set((state) => {
          state.edges = applyEdgeChanges(changes, state.edges) as Edge<GraphEdgeData>[];
        }),

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
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.add(nodeId);
          }
          state.selectedNodeIds = next;
        }),

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

      hideNodes: (nodeIds) =>
        set((state) => {
          for (const id of nodeIds) {
            state.hiddenNodeIds.add(id);
          }
        }),

      showAllNodes: () =>
        set((state) => {
          state.hiddenNodeIds = new Set();
        }),

      updateNodePositions: (positions) =>
        set((state) => {
          for (const node of state.nodes) {
            const pos = positions.get(node.id);
            if (pos) {
              node.position = pos;
            }
          }
        }),

      // ── Flow animation actions ──

      startFlowReplay: (runtimeEdges) =>
        set((state) => {
          state.flowMode = 'replay';
          state.activeFlowStep = null;
          state.activeNodeId = null;
          state.activeEdgeIds = new Set();
          state.completedNodeIds = new Set();
          state.errorNodeIds = new Set();
          state.callStack = [];
          // Inject runtime edges as React Flow edges
          state.runtimeEdges = runtimeEdges.map((re) => ({
            id: re.id,
            source: re.sourceNodeId,
            target: re.targetNodeId,
            type: 'runtime' as const,
            animated: true,
            data: { edgeType: 'calls' as const, isRuntime: true },
            style: {
              stroke: 'oklch(0.7 0.2 195)', // cyan
              strokeDasharray: '5 3',
              strokeWidth: 2,
            },
          }));
        }),

      setFlowStep: (step) =>
        set((state) => {
          const prev = state.activeFlowStep;

          // Mark previous node as completed (or error)
          if (prev?.nodeId) {
            if (prev.status === 'error') {
              state.errorNodeIds.add(prev.nodeId);
            } else {
              state.completedNodeIds.add(prev.nodeId);
            }
          }

          state.activeFlowStep = step;
          state.activeNodeId = step.nodeId;

          // Activate the edge from parent → current
          state.activeEdgeIds = new Set<string>();
          if (step.edgeId) {
            state.activeEdgeIds.add(step.edgeId);
          }

          // Mark error node
          if (step.status === 'error' && step.nodeId) {
            state.errorNodeIds.add(step.nodeId);
          }

          // Update call stack
          // Trim stack to current depth then push
          state.callStack = state.callStack.slice(0, step.depth);
          state.callStack.push(step);
        }),

      clearFlowReplay: () =>
        set((state) => {
          state.flowMode = 'static';
          state.activeFlowStep = null;
          state.activeNodeId = null;
          state.activeEdgeIds = new Set();
          state.completedNodeIds = new Set();
          state.errorNodeIds = new Set();
          state.runtimeEdges = [];
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

      // ── Focus + Search ──

      setFocusMode: (nodeId) =>
        set((state) => {
          const connected = new Set<string>([nodeId]);
          for (const edge of state.edges) {
            if (edge.source === nodeId) connected.add(edge.target);
            if (edge.target === nodeId) connected.add(edge.source);
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
