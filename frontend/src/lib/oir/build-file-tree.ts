import type { OmniousNode } from '@/lib/stores/graph-store';
import type { OIRNodeType } from './types';

/** A node in the file tree — either a directory or a code symbol */
export interface FileTreeNode {
  /** Unique key for React rendering */
  id: string;
  /** Display label (filename or symbol name) */
  label: string;
  /** Full path for directories, node ID for symbols */
  path: string;
  /** 'dir' for folders, OIR type for symbols */
  kind: 'dir' | OIRNodeType;
  /** Graph node ID (only for symbol leaves) */
  nodeId?: string;
  /** Line number in source file */
  lineStart?: number | null;
  /** Error count from heatmap */
  errorCount?: number;
  /** Children (subdirectories + symbols) */
  children: FileTreeNode[];
  /** Community mode: whether this symbol is in the current canvas subgraph */
  inSubgraph?: boolean;
  /** Community group: color swatch */
  communityColor?: string;
  /** Community group: total node count from API */
  communityNodeCount?: number;
}

/**
 * Build a file-tree hierarchy from the current React Flow nodes.
 * Groups by file_path directories, with code symbols as leaves sorted by line number.
 */
export function buildFileTree(nodes: OmniousNode[]): FileTreeNode[] {
  const dirMap = new Map<string, FileTreeNode>();

  // Ensure a directory node exists for the given path, creating parents as needed
  function ensureDir(dirPath: string): FileTreeNode {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;

    const segments = dirPath.split('/').filter(Boolean);
    const label = segments[segments.length - 1] ?? dirPath;

    const node: FileTreeNode = {
      id: `dir:${dirPath}`,
      label,
      path: dirPath,
      kind: 'dir',
      children: [],
    };
    dirMap.set(dirPath, node);

    // Link to parent
    if (segments.length > 1) {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = ensureDir(parentPath);
      if (!parent.children.some((c) => c.id === node.id)) {
        parent.children.push(node);
      }
    }

    return node;
  }

  // Process each graph node
  for (const n of nodes) {
    const filePath = n.data.filePath;
    if (!filePath) continue;

    const normalizedPath = filePath.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? normalizedPath;
    const dirPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '.';

    // Ensure directory exists
    const dir = ensureDir(dirPath);

    // Find or create the file-level node
    const fileId = `file:${normalizedPath}`;
    let fileNode = dir.children.find((c) => c.id === fileId);
    if (!fileNode) {
      fileNode = {
        id: fileId,
        label: fileName,
        path: normalizedPath,
        kind: 'module',
        children: [],
      };
      dir.children.push(fileNode);
    }

    // Add the symbol as a leaf under the file
    fileNode.children.push({
      id: `sym:${n.id}`,
      label: n.data.label,
      path: normalizedPath,
      kind: n.data.oirType,
      nodeId: n.id,
      lineStart: n.data.lineStart,
      errorCount: n.data.errorCount,
      children: [],
    });
  }

  // Sort children: dirs first, then files, then symbols by line number
  function sortTree(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      // Dirs before files/symbols
      if (a.kind === 'dir' && b.kind !== 'dir') return -1;
      if (a.kind !== 'dir' && b.kind === 'dir') return 1;
      // Files (no nodeId) before symbols (has nodeId)
      if (!a.nodeId && b.nodeId) return -1;
      if (a.nodeId && !b.nodeId) return 1;
      // Sort symbols by line number
      if (a.lineStart != null && b.lineStart != null) return a.lineStart - b.lineStart;
      // Alphabetical fallback
      return a.label.localeCompare(b.label);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortTree(node.children);
    }
  }

  // Collect root nodes (directories without parents)
  const roots: FileTreeNode[] = [];
  for (const [path, node] of dirMap) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 1) {
      roots.push(node);
    }
  }

  // If only dots/single root, also check for orphaned dirs
  if (roots.length === 0) {
    roots.push(...dirMap.values());
  }

  sortTree(roots);

  // Collapse single-child directory chains (e.g., src/lib → src/lib)
  function collapse(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.map((node) => {
      while (node.kind === 'dir' && node.children.length === 1 && node.children[0].kind === 'dir') {
        const child = node.children[0];
        node = {
          ...node,
          id: child.id,
          label: `${node.label}/${child.label}`,
          path: child.path,
          children: child.children,
        };
      }
      if (node.children.length > 0) {
        node = { ...node, children: collapse(node.children) };
      }
      return node;
    });
  }

  return collapse(roots);
}
