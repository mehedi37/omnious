/**
 * D3 graph engine — shared type definitions.
 *
 * D3SimNode extends OmniousNodeData with positional/velocity fields
 * required by d3-force. D3SimLink is the resolved link type where
 * source/target are references to D3SimNode objects (not ID strings).
 */

import type { OmniousEdgeData, OmniousNodeData } from '@/lib/stores/graph-store';
import type { OIRNodeType } from '@/lib/oir/types';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

// ─── D3 simulation types ───────────────────────────────────────────────────

export interface D3SimNode extends SimulationNodeDatum, OmniousNodeData {
  /** Graph node id (matches OmniousNode.id) */
  id: string;
  /** Canvas-space width for hit testing and rendering */
  width: number;
  /** Canvas-space height for hit testing and rendering */
  height: number;
}

/** D3 resolved link — source/target are D3SimNode references after simulation init */
export interface D3SimLink extends SimulationLinkDatum<D3SimNode> {
  /** Edge id */
  id: string;
  /** Edge data payload */
  data: OmniousEdgeData;
  /** Cached resolved source node (set by d3-force) */
  source: D3SimNode;
  /** Cached resolved target node (set by d3-force) */
  target: D3SimNode;
}

// ─── Visual state ──────────────────────────────────────────────────────────

/** All rendering-relevant state from the Zustand graph store */
export interface GraphVisualState {
  selectedNodeIds: Set<string>;
  focusedNodeId: string | null;
  connectedNodeIds: Set<string>;
  heatmapActive: boolean;
  heatmapData: Map<string, { errorCount: number; errorSeverity: string; heatLevel: string }>;
  pinnedNodeIds: Set<string>;
  errorFlowNodeIds: Set<string>;
  errorFlowEdgeIds: Set<string>;
  activeNodeId: string | null;
  activeEdgeIds: Set<string>;
  completedNodeIds: Set<string>;
  errorNodeIds: Set<string>;
  nodeTypeFilters: Set<OIRNodeType>;
  severityFilters: Set<string>;
  hoveredEdgeId: string | null;
  clusterMap: Map<string, { label: string; color: string; layer: string | null }>;
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
}

// ─── Level of detail ──────────────────────────────────────────────────────

/** Canvas LOD level based on current zoom scale */
export type LODLevel = 'dot' | 'pill' | 'card';

export function getLOD(scale: number): LODLevel {
  if (scale < 0.25) return 'dot';
  if (scale < 0.6) return 'pill';
  return 'card';
}

// ─── Canvas theme ──────────────────────────────────────────────────────────

export interface CanvasTheme {
  bg: string;
  nodeBg: string;
  nodeBorder: string;
  nodeText: string;
  nodeSubtext: string;
  edgeDefault: string;
  gridDot: string;
}

export const DARK_THEME: CanvasTheme = {
  bg:          '#07080e',
  nodeBg:      '#0d0f1c',
  nodeBorder:  '#1a1d30',
  nodeText:    '#f0f4ff',
  nodeSubtext: '#7b8db0',
  edgeDefault: '#252b40',
  gridDot:     '#13162a',
};

// ─── Engine callbacks ──────────────────────────────────────────────────────

export interface EngineCallbacks {
  onNodeClick: (nodeId: string) => void;
  onNodeContextMenu: (nodeId: string, nodeName: string, x: number, y: number) => void;
  onPaneContextMenu: (x: number, y: number) => void;
  onEdgeHover: (edgeId: string | null) => void;
}
