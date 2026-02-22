import type { MultiDirectedGraph } from 'graphology';
import { EDGE_COLORS, NODE_COLORS } from './constants';
import type { CodeEdge, CodeNode, ErrorHeatmapEntry, OIREdgeType } from './types';
import type { SigmaEdgeAttributes, SigmaNodeAttributes } from '@/lib/stores/graph-store';
import type { ViewMode } from '@/lib/stores/graph-store';

/** Grid layout constants for initial placement before ELK runs */
const INDIVIDUAL_GRID_COLS = 8;
const INDIVIDUAL_SPACING_X = 280;
const INDIVIDUAL_SPACING_Y = 120;
const GROUP_GRID_COLS = 5;
const GROUP_SPACING_X = 320;
const GROUP_SPACING_Y = 180;

/**
 * Push CodeNodes + CodeEdges directly into a graphology MultiDirectedGraph.
 * Clears previous individual + group nodes, then repopulates.
 * Also assigns `hidden` on nodes based on the current viewMode.
 */
export function pushCodesToGraph(
  codeNodes: CodeNode[],
  codeEdges: CodeEdge[],
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  viewMode: ViewMode,
): { nodeToGroupId: Map<string, string> } {
  // ── Drop all non-runtime nodes / edges ─────────────────────────────────────
  // (Runtime edges added by trace replay are tagged isRuntime and preserved.)
  const runtimeEdgeKeys = graph.filterEdges((_, attrs) => !!attrs.isRuntime);
  const allNodes = graph.nodes();
  for (const n of allNodes) graph.dropNode(n); // also drops all attached edges
  // Re-add any runtime edges that were dropped above (they reference old node keys)
  // — we keep them as orphans; sigma handles missing endpoints gracefully.

  // ── Individual nodes ────────────────────────────────────────────────────────
  codeNodes.forEach((node, index) => {
    const x = (index % INDIVIDUAL_GRID_COLS) * INDIVIDUAL_SPACING_X;
    const y = Math.floor(index / INDIVIDUAL_GRID_COLS) * INDIVIDUAL_SPACING_Y;

    if (graph.hasNode(node.id)) graph.dropNode(node.id);

    graph.addNode(node.id, {
      x,
      y,
      size: 10,
      color: NODE_COLORS[node.type] ?? '#888',
      label: node.name,
      hidden: viewMode === 'grouped',
      oirType: node.type,
      filePath: node.file_path,
      lineStart: node.line_start,
      lineEnd: node.line_end,
      signature: node.signature,
      docComment: node.doc_comment,
      metadata: node.metadata ?? {},
      isGroup: false,
      isIndividual: true,
    });
  });

  // ── Individual edges ────────────────────────────────────────────────────────
  for (const edge of codeEdges) {
    if (!graph.hasNode(edge.source_node_id) || !graph.hasNode(edge.target_node_id)) continue;
    if (graph.hasEdge(edge.id)) graph.dropEdge(edge.id);

    graph.addEdgeWithKey(edge.id, edge.source_node_id, edge.target_node_id, {
      color: EDGE_COLORS[edge.type] ?? '#555',
      size: 1.5,
      hidden: viewMode === 'grouped',
      edgeType: edge.type,
    });
  }

  // ── Group nodes ─────────────────────────────────────────────────────────────
  const dirGroups = new Map<string, CodeNode[]>();
  for (const node of codeNodes) {
    const dir = node.file_path.split('/').slice(0, -1).join('/') || '/';
    const existing = dirGroups.get(dir) ?? [];
    existing.push(node);
    dirGroups.set(dir, existing);
  }

  const nodeToGroupId = new Map<string, string>();
  let groupIndex = 0;

  for (const [dir, children] of dirGroups.entries()) {
    const groupId = `group:${dir}`;

    const typeBreakdown: Record<string, number> = {};
    for (const child of children) {
      typeBreakdown[child.type] = (typeBreakdown[child.type] ?? 0) + 1;
    }

    let dominantType = 'module';
    let maxCount = 0;
    for (const [type, count] of Object.entries(typeBreakdown)) {
      if (count > maxCount) { maxCount = count; dominantType = type; }
    }

    const segments = dir.split('/').filter(Boolean);
    const label = segments.length > 0 ? segments[segments.length - 1] : 'root';

    const x = (groupIndex % GROUP_GRID_COLS) * GROUP_SPACING_X;
    const y = Math.floor(groupIndex / GROUP_GRID_COLS) * GROUP_SPACING_Y;

    if (graph.hasNode(groupId)) graph.dropNode(groupId);
    graph.addNode(groupId, {
      x, y,
      size: 18,
      color: NODE_COLORS[dominantType as keyof typeof NODE_COLORS] ?? '#888',
      label,
      hidden: viewMode === 'individual',
      oirType: null,
      filePath: null, lineStart: null, lineEnd: null, signature: null, docComment: null,
      metadata: {},
      isGroup: true,
      directory: dir,
      childCount: children.length,
      childNodeIds: children.map((c) => c.id),
      typeBreakdown,
      dominantType,
      isIndividual: false,
    });

    for (const child of children) nodeToGroupId.set(child.id, groupId);
    groupIndex++;
  }

  // ── Group edges ─────────────────────────────────────────────────────────────
  const groupEdgeSet = new Set<string>();
  for (const edge of codeEdges) {
    const sg = nodeToGroupId.get(edge.source_node_id);
    const tg = nodeToGroupId.get(edge.target_node_id);
    if (!sg || !tg || sg === tg) continue;

    const key = `${sg}→${tg}:${edge.type}`;
    if (groupEdgeSet.has(key)) continue;
    groupEdgeSet.add(key);

    const groupEdgeId = `ge:${key}`;
    if (graph.hasEdge(groupEdgeId)) graph.dropEdge(groupEdgeId);
    if (!graph.hasNode(sg) || !graph.hasNode(tg)) continue;

    graph.addEdgeWithKey(groupEdgeId, sg, tg, {
      color: EDGE_COLORS[edge.type] ?? '#555',
      size: 2,
      hidden: viewMode === 'individual',
      edgeType: edge.type,
    });
  }

  return { nodeToGroupId };
}

/**
 * Apply error heatmap data to graphology nodes — merges errorCount + errorSeverity
 * into node attributes directly (mutation, no re-render needed — sigma.refresh() will pick it up).
 */
export function applyErrorHeatmapToGraph(
  heatmap: ErrorHeatmapEntry[],
  graph: MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>,
): void {
  for (const entry of heatmap) {
    if (!graph.hasNode(entry.code_node_id)) continue;
    graph.setNodeAttribute(entry.code_node_id, 'errorCount', entry.error_count);
    graph.setNodeAttribute(entry.code_node_id, 'errorSeverity', entry.severity);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Whether this edge type represents a runtime data flow (not static import) */
function isRuntimeEdge(type: OIREdgeType): boolean {
  return ['calls', 'routes_to', 'queries', 'emits_event', 'subscribes_to', 'renders'].includes(
    type,
  );
}
