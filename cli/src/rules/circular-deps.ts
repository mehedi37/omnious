import type { Rule } from './types.js';

/**
 * circular-deps: Detect circular dependency chains in the import graph.
 *
 * Uses Tarjan's algorithm to find strongly connected components (SCCs).
 * Any SCC with more than one node represents a circular dependency.
 */
export const circularDepsRule: Rule = {
  id: 'circular-deps',
  description: 'Detect circular import dependencies between modules',
  severity: 'warning',

  run(ctx) {
    // Build module-level import graph
    const importEdges = [...ctx.outgoingEdges.entries()].flatMap(
      ([, edges]) => edges.filter((e) => e.type === 'imports'),
    );

    // Build adjacency from module nodes only
    const moduleNodes = ctx.nodes.filter((n) => n.type === 'module');
    const moduleIds = new Set(moduleNodes.map((n) => n.oir_id));

    // For each module, find which modules it imports
    // An import edge goes from a module to another module
    const adj = new Map<string, Set<string>>();
    for (const id of moduleIds) {
      adj.set(id, new Set());
    }

    for (const edge of importEdges) {
      if (moduleIds.has(edge.source_oir_id) && moduleIds.has(edge.target_oir_id)) {
        adj.get(edge.source_oir_id)!.add(edge.target_oir_id);
      }
    }

    // Tarjan's SCC
    const sccs = tarjanSCC(adj);

    return sccs
      .filter((scc) => scc.length > 1)
      .flatMap((scc) => {
        const files = scc
          .map((id) => ctx.nodeMap.get(id)?.file_path ?? id)
          .sort();
        const cycle = files.join(' → ') + ' → ' + files[0];

        return scc.map((id) => {
          const node = ctx.nodeMap.get(id);
          return {
            rule_id: 'circular-deps',
            severity: 'warning' as const,
            message: `Circular dependency detected: ${cycle}`,
            code_node_oir_id: id,
            file_path: node?.file_path ?? 'unknown',
            line_start: node?.line_start ?? null,
            line_end: node?.line_end ?? null,
            metadata: {
              cycle_size: scc.length,
              cycle_files: files,
            },
          };
        });
      });
  },
};

/** Tarjan's algorithm for finding strongly connected components */
function tarjanSCC(adj: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const result: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  }

  for (const v of adj.keys()) {
    if (!indices.has(v)) {
      strongConnect(v);
    }
  }

  return result;
}
