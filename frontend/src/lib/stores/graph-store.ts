import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { GraphNodeData, GraphEdgeData } from '../oir/transforms';
import type { ZoomLevel } from '../oir/constants';

interface GraphState {
  nodes: Node<GraphNodeData>[];
  edges: Edge<GraphEdgeData>[];
  selectedNodeIds: Set<string>;
  zoomLevel: ZoomLevel;
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
  hiddenNodeIds: Set<string>;
  heatmapActive: boolean;
  isLayouting: boolean;

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
    })),
  ),
);
