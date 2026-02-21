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

/**
 * Transform backend code_nodes → React Flow Nodes.
 * Pure function — no side effects, easily testable.
 */
export function codeNodesToReactFlow(codeNodes: CodeNode[]): Node<GraphNodeData>[] {
  return codeNodes.map((node) => ({
    id: node.id,
    type: mapNodeType(node.type),
    position: { x: 0, y: 0 }, // positioned by ELK layout
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
