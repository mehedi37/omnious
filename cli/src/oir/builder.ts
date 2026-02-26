import type {
  OIRNode,
  OIREdge,
  OIRIndex,
  ParseResult,
  IndexSummary,
  OIRNodeType,
  OIREdgeType,
} from './types.js';
import { hashProject } from './hasher.js';

/**
 * Aggregates parse results from multiple files into a unified OIR graph.
 * Handles cross-file edge resolution and deduplication.
 */
export class OIRBuilder {
  private nodes: Map<string, OIRNode> = new Map();
  private edges: OIREdge[] = [];
  private fileHashes: Map<string, string> = new Map();
  private parseErrors: number = 0;

  /** Add results from parsing a single file */
  addParseResult(result: ParseResult, fileHash: string): void {
    for (const node of result.nodes) {
      this.nodes.set(node.oir_id, node);
      // Track file hash from the module node
      if (!this.fileHashes.has(node.file_path)) {
        this.fileHashes.set(node.file_path, fileHash);
      }
    }
    for (const edge of result.edges) {
      this.edges.push(edge);
    }
    this.parseErrors += result.errors.length;
  }

  /** Set file hash directly (for files that produced nodes) */
  setFileHash(filePath: string, hash: string): void {
    this.fileHashes.set(filePath, hash);
  }

  /**
   * Resolve cross-file edges using a two-pass approach:
   *
   * Pass 1: Build lookup maps:
   *   - moduleByPath: file_path → module oir_id (for import resolution)
   *   - nodeByName: (name + type) → oir_id (for call/extends/renders resolution)
   *
   * Pass 2: Resolve edges:
   *   - Import edges: target is a file path → resolve to module oir_id
   *   - Call/extends/implements/renders: target is __unresolved__::name::type
   *     → resolve using the name+type lookup map
   */
  resolveEdges(): void {
    // Pass 1: Build lookup maps
    const moduleByPath = new Map<string, string>();
    const nodeByName = new Map<string, string>(); // "name::type" → first matching oir_id

    for (const node of this.nodes.values()) {
      if (node.type === 'module') {
        moduleByPath.set(node.file_path, node.oir_id);

        // Also register the module under common import aliases:
        // e.g. "src/utils/fs" matches import from "./utils/fs"
        const withoutExt = node.file_path.replace(/\.[^.]+$/, '');
        moduleByPath.set(withoutExt, node.oir_id);

        // Also match /index paths
        if (!withoutExt.endsWith('/index')) {
          moduleByPath.set(withoutExt + '/index', node.oir_id);
        }
      }

      // Build name→oir_id map (first occurrence wins, which is typically the definition)
      const nameKey = `${node.name}::${node.type}`;
      if (!nodeByName.has(nameKey)) {
        nodeByName.set(nameKey, node.oir_id);
      }
    }

    // Pass 2: Resolve edges
    this.edges = this.edges.map((edge) => {
      // Case 1: Unresolved placeholder from extractors (calls, extends, renders, implements)
      if (edge.target_oir_id.startsWith('__unresolved__::')) {
        const parts = edge.target_oir_id.split('::');
        const targetName = parts[1] ?? '';
        const targetType = parts[2] ?? 'function';

        // Try exact name+type match
        const nameKey = `${targetName}::${targetType}`;
        const resolvedId = nodeByName.get(nameKey);
        if (resolvedId) {
          return { ...edge, target_oir_id: resolvedId };
        }

        // Fallback: try matching name as function (calls to methods etc.)
        if (targetType !== 'function') {
          const funcKey = `${targetName}::function`;
          const funcId = nodeByName.get(funcKey);
          if (funcId) return { ...edge, target_oir_id: funcId };
        }

        // Fallback: try matching name as component (for renders edges)
        if (targetType !== 'component') {
          const compKey = `${targetName}::component`;
          const compId = nodeByName.get(compKey);
          if (compId) return { ...edge, target_oir_id: compId };
        }

        return edge; // Unresolved — will be filtered below
      }

      // Case 2: File path target (from import resolution)
      if (
        edge.target_oir_id.includes('/') ||
        edge.target_oir_id.includes('\\')
      ) {
        // Try direct path match
        const resolvedId = moduleByPath.get(edge.target_oir_id);
        if (resolvedId) {
          return { ...edge, target_oir_id: resolvedId };
        }

        // Try without extension
        const withoutExt = edge.target_oir_id.replace(/\.[^.]+$/, '');
        const withoutExtId = moduleByPath.get(withoutExt);
        if (withoutExtId) {
          return { ...edge, target_oir_id: withoutExtId };
        }

        // Try /index
        const indexId = moduleByPath.get(withoutExt + '/index');
        if (indexId) {
          return { ...edge, target_oir_id: indexId };
        }
      }

      return edge;
    });

    // Deduplicate edges (same source + target + type)
    const seen = new Set<string>();
    this.edges = this.edges.filter((edge) => {
      const key = `${edge.source_oir_id}::${edge.target_oir_id}::${edge.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter out edges with unresolved targets (target doesn't exist in nodes)
    const nodeIds = new Set(this.nodes.keys());
    this.edges = this.edges.filter(
      (edge) =>
        nodeIds.has(edge.source_oir_id) && nodeIds.has(edge.target_oir_id),
    );
  }

  /** Build the final OIR index */
  build(): OIRIndex {
    this.resolveEdges();

    const nodes = [...this.nodes.values()];
    const edges = this.edges;
    const projectHash = hashProject(this.fileHashes);

    const summary: IndexSummary = {
      total_files: this.fileHashes.size,
      total_nodes: nodes.length,
      total_edges: edges.length,
      nodes_by_type: this.countByType(nodes, 'type') as Partial<
        Record<OIRNodeType, number>
      >,
      edges_by_type: this.countByType(edges, 'type') as Partial<
        Record<OIREdgeType, number>
      >,
      parse_errors: this.parseErrors,
    };

    return {
      version: 1,
      timestamp: new Date().toISOString(),
      project_hash: projectHash,
      files: Object.fromEntries(this.fileHashes),
      nodes,
      edges,
      summary,
    };
  }

  private countByType<T>(
    items: T[],
    key: keyof T,
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const type = String(item[key]);
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }
}
