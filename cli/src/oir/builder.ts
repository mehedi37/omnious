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
   * Resolve cross-file edges:
   * Import edges reference target modules by file path.
   * We need to find the actual module node oir_id for the target.
   */
  resolveEdges(): void {
    const moduleByPath = new Map<string, string>();
    for (const node of this.nodes.values()) {
      if (node.type === 'module') {
        moduleByPath.set(node.file_path, node.oir_id);
      }
    }

    // Resolve edges where target_oir_id is a file path placeholder
    this.edges = this.edges.map((edge) => {
      // If target looks like a file path (contains / or \), resolve to module oir_id
      if (
        edge.target_oir_id.includes('/') ||
        edge.target_oir_id.includes('\\')
      ) {
        const resolvedId = moduleByPath.get(edge.target_oir_id);
        if (resolvedId) {
          return { ...edge, target_oir_id: resolvedId };
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
