import type { Rule } from './types.js';

/**
 * unused-exports: Find exported symbols that are never imported anywhere.
 *
 * An export is considered "unused" if no `imports` or `uses` edge targets
 * the exporting node from any other file.
 */
export const unusedExportsRule: Rule = {
  id: 'unused-exports',
  description: 'Find exported symbols that are never imported by other modules',
  severity: 'info',

  run(ctx) {
    // Collect all nodes that have an outgoing 'exports' edge from their module
    // In OIR, an export edge: module → exported symbol
    const exportedNodeIds = new Set<string>();
    for (const [, edges] of ctx.outgoingEdges) {
      for (const edge of edges) {
        if (edge.type === 'exports') {
          exportedNodeIds.add(edge.target_oir_id);
        }
      }
    }

    if (exportedNodeIds.size === 0) return [];

    // Find which exported nodes are actually imported/used by nodes in OTHER files
    const usedNodeIds = new Set<string>();
    for (const [sourceId, edges] of ctx.outgoingEdges) {
      const sourceNode = ctx.nodeMap.get(sourceId);
      for (const edge of edges) {
        if (
          (edge.type === 'imports' || edge.type === 'uses' || edge.type === 'calls') &&
          exportedNodeIds.has(edge.target_oir_id)
        ) {
          // Only count as "used" if the consumer is in a different file
          const targetNode = ctx.nodeMap.get(edge.target_oir_id);
          if (sourceNode && targetNode && sourceNode.file_path !== targetNode.file_path) {
            usedNodeIds.add(edge.target_oir_id);
          }
        }
      }
    }

    // Whatever is exported but never used externally is "unused"
    const unusedIds = [...exportedNodeIds].filter((id) => !usedNodeIds.has(id));

    return unusedIds.map((id) => {
      const node = ctx.nodeMap.get(id);
      return {
        rule_id: 'unused-exports',
        severity: 'info' as const,
        message: `Exported symbol "${node?.name ?? id}" is never imported by other modules`,
        code_node_oir_id: id,
        file_path: node?.file_path ?? 'unknown',
        line_start: node?.line_start ?? null,
        line_end: node?.line_end ?? null,
        metadata: {
          symbol_name: node?.name ?? id,
          symbol_type: node?.type ?? 'unknown',
        },
      };
    });
  },
};
