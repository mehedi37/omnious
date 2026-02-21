import type { Edge, Node } from '@xyflow/react';
import { EDGE_COLORS, NODE_COLORS } from './constants';
import type { CodeEdge, CodeNode, ErrorHeatmapEntry, OIREdgeType } from './types';

/** React Flow node data shape */
export interface GraphNodeData extends Record<string, unknown> {
  label: string;
  oirType: CodeNode['type'];
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  docComment: string | null;
  metadata: Record<string, unknown>;
  errorCount?: number;
  errorSeverity?: string;
}

/** React Flow edge data shape */
export interface GraphEdgeData extends Record<string, unknown> {
  edgeType: OIREdgeType;
  animated?: boolean;
}

/** Grid columns used for initial node placement before ELK runs */
const INITIAL_GRID_COLS = 8;
const INITIAL_GRID_SPACING_X = 280;
const INITIAL_GRID_SPACING_Y = 120;

/**
 * Transform backend code_nodes → React Flow Nodes.
 * Pure function — no side effects, easily testable.
 * Nodes get initial grid positions so they don't pile at (0,0) before ELK completes.
 */
export function codeNodesToReactFlow(codeNodes: CodeNode[]): Node<GraphNodeData>[] {
  return codeNodes.map((node, index) => ({
    id: node.id,
    type: mapNodeType(node.type),
    position: {
      x: (index % INITIAL_GRID_COLS) * INITIAL_GRID_SPACING_X,
      y: Math.floor(index / INITIAL_GRID_COLS) * INITIAL_GRID_SPACING_Y,
    },
    data: {
      label: node.name,
      oirType: node.type,
      filePath: node.file_path,
      lineStart: node.line_start,
      lineEnd: node.line_end,
      signature: node.signature,
      docComment: node.doc_comment,
      metadata: node.metadata ?? {},
    },
    style: {
      borderColor: NODE_COLORS[node.type],
    },
  }));
}

/**
 * Transform backend code_edges → React Flow Edges.
 */
export function codeEdgesToReactFlow(codeEdges: CodeEdge[]): Edge<GraphEdgeData>[] {
  return codeEdges.map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: isRuntimeEdge(edge.type) ? 'dataFlow' : 'dependency',
    animated: isRuntimeEdge(edge.type),
    data: {
      edgeType: edge.type,
    },
    style: {
      stroke: EDGE_COLORS[edge.type],
    },
  }));
}

/**
 * Apply error heatmap data to React Flow nodes — merges error counts + severity into node data.
 */
export function applyErrorHeatmap(
  nodes: Node<GraphNodeData>[],
  heatmap: ErrorHeatmapEntry[],
): Node<GraphNodeData>[] {
  const errorMap = new Map(heatmap.map((entry) => [entry.code_node_id, entry]));

  return nodes.map((node) => {
    const error = errorMap.get(node.id);
    if (!error) return node;

    return {
      ...node,
      data: {
        ...node.data,
        errorCount: error.error_count,
        errorSeverity: error.severity,
      },
    };
  });
}

/**
 * Group nodes by file's parent module for zoomed-out views.
 */
export function groupNodesByModule(
  nodes: Node<GraphNodeData>[],
): Map<string, Node<GraphNodeData>[]> {
  const groups = new Map<string, Node<GraphNodeData>[]>();
  for (const node of nodes) {
    const dir = node.data.filePath.split('/').slice(0, -1).join('/') || '/';
    const existing = groups.get(dir) ?? [];
    existing.push(node);
    groups.set(dir, existing);
  }
  return groups;
}

/** Data shape for group summary nodes */
export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  directory: string;
  childCount: number;
  childNodeIds: string[];
  typeBreakdown: Record<string, number>;
  dominantType: string;
}

/** Result of building a grouped graph */
export interface GroupedGraph {
  groupNodes: Node<GroupNodeData>[];
  groupEdges: Edge<GraphEdgeData>[];
  /** Map from group node ID → list of individual child node IDs */
  nodeToGroupId: Map<string, string>;
}

/**
 * Build a grouped graph from individual nodes and edges.
 * Groups nodes by directory (filePath dirname), creates summary group nodes,
 * and aggregates edges between groups.
 */
export function buildGroupedGraph(
  nodes: Node<GraphNodeData>[],
  edges: Edge<GraphEdgeData>[],
): GroupedGraph {
  // Step 1: Group nodes by directory
  const dirGroups = groupNodesByModule(nodes);

  // Step 2: Build group summary nodes
  const groupNodes: Node<GroupNodeData>[] = [];
  const nodeToGroupId = new Map<string, string>();
  let groupIndex = 0;

  for (const [dir, children] of dirGroups.entries()) {
    const groupId = `group:${dir}`;

    // Count types
    const typeBreakdown: Record<string, number> = {};
    for (const child of children) {
      const t = child.data.oirType;
      typeBreakdown[t] = (typeBreakdown[t] ?? 0) + 1;
    }

    // Find dominant type
    let dominantType = 'module';
    let maxCount = 0;
    for (const [type, count] of Object.entries(typeBreakdown)) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type;
      }
    }

    // Derive a short label from the directory path
    const segments = dir.split('/').filter(Boolean);
    const label = segments.length > 0 ? segments[segments.length - 1] : 'root';

    groupNodes.push({
      id: groupId,
      type: 'group',
      position: {
        x: (groupIndex % 5) * 320,
        y: Math.floor(groupIndex / 5) * 180,
      },
      data: {
        label,
        directory: dir,
        childCount: children.length,
        childNodeIds: children.map((c) => c.id),
        typeBreakdown,
        dominantType,
      },
    });

    // Map each child to this group
    for (const child of children) {
      nodeToGroupId.set(child.id, groupId);
    }

    groupIndex++;
  }

  // Step 3: Aggregate edges between groups
  const edgeSet = new Set<string>();
  const groupEdges: Edge<GraphEdgeData>[] = [];

  for (const edge of edges) {
    const sourceGroup = nodeToGroupId.get(edge.source);
    const targetGroup = nodeToGroupId.get(edge.target);

    if (!sourceGroup || !targetGroup) continue;
    // Skip intra-group edges
    if (sourceGroup === targetGroup) continue;

    // Deduplicate: one edge per group pair per edge type
    const edgeType = edge.data?.edgeType ?? 'uses';
    const key = `${sourceGroup}→${targetGroup}:${edgeType}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    groupEdges.push({
      id: `ge:${sourceGroup}→${targetGroup}:${edgeType}`,
      source: sourceGroup,
      target: targetGroup,
      type: isRuntimeEdge(edgeType) ? 'dataFlow' : 'dependency',
      animated: false,
      data: { edgeType },
      style: { stroke: EDGE_COLORS[edgeType] },
    });
  }

  return { groupNodes, groupEdges, nodeToGroupId };
}

/** Map OIR node type to React Flow custom node type name */
function mapNodeType(type: CodeNode['type']): string {
  switch (type) {
    case 'module':
    case 'variable':
    case 'type_def':
      return 'module';
    case 'component':
      return 'component';
    case 'function':
    case 'class':
      return 'function';
    case 'route':
    case 'middleware':
      return 'route';
    case 'database_query':
      return 'database';
    case 'event_emitter':
    case 'event_listener':
    case 'external_api':
      return 'service';
    default:
      return 'function';
  }
}

/** Whether this edge type represents a runtime data flow (not static import) */
function isRuntimeEdge(type: OIREdgeType): boolean {
  return ['calls', 'routes_to', 'queries', 'emits_event', 'subscribes_to', 'renders'].includes(
    type,
  );
}
