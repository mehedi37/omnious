'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileCode,
  Filter,
  Folder,
  FolderOpen,
  FolderTree,
  FoldVertical,
  Minus,
  Network,
  Search,
  Square,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buildFileTree, type FileTreeNode } from '@/lib/oir/build-file-tree';
import { NODE_TYPE_COLORS, NODE_TYPE_ICONS } from '@/lib/oir/constants';
import { toOmniousEdges, toOmniousNodes, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/client';

function getTypeIcon(kind: string) {
  return NODE_TYPE_ICONS[kind as keyof typeof NODE_TYPE_ICONS] ?? FileCode;
}

function getTypeColor(kind: string) {
  return NODE_TYPE_COLORS[kind as keyof typeof NODE_TYPE_COLORS] ?? 'text-muted-foreground';
}

/** A flattened row in the virtualized tree */
interface FlatRow {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

const ROW_HEIGHT = 28;

/** Collect IDs of all nodes at depth < threshold for initial expansion */
function collectInitialExpanded(tree: FileTreeNode[], threshold: number): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: FileTreeNode[], depth: number) {
    for (const node of nodes) {
      if (depth < threshold && node.children.length > 0) {
        ids.add(node.id);
        walk(node.children, depth + 1);
      }
    }
  }
  walk(tree, 0);
  return ids;
}

/** Flatten tree into visible rows based on expanded state and search filter */
function flattenTree(
  tree: FileTreeNode[],
  expandedIds: Set<string>,
  searchQuery: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const q = searchQuery.toLowerCase();

  function walk(nodes: FileTreeNode[], depth: number) {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedIds.has(node.id);

      // Filter: if search is active and this leaf doesn't match, hide it
      if (q) {
        const matchesSelf =
          node.label.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
        const matchesChild = hasChildren && hasMatchingChild(node, q);
        if (!matchesSelf && !matchesChild) continue;
      }

      rows.push({ node, depth, isExpanded, hasChildren });

      // When searching, always expand nodes with matching children
      if (hasChildren && (isExpanded || q)) {
        walk(node.children, depth + 1);
      }
    }
  }

  walk(tree, 0);
  return rows;
}

/** Single virtualized tree row */
const VirtualTreeRow = memo(function VirtualTreeRow({
  row,
  selectedNodeId,
  subgraphNodeIds,
  checkedNodeIds,
  summaryMap,
  nodeRefs,
  onSelectNode,
  onToggleCheck,
  onToggleExpand,
  onToggleFolderCheck,
  folderCheckState,
}: {
  row: FlatRow;
  selectedNodeId: string | null;
  subgraphNodeIds: Set<string>;
  checkedNodeIds: Set<string>;
  summaryMap: Map<string, string>;
  nodeRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onSelectNode: (nodeId: string) => void;
  onToggleCheck: (nodeId: string) => void;
  onToggleExpand: (nodeId: string) => void;
  onToggleFolderCheck: (nodeTreeId: string) => void;
  /** 'all' | 'some' | 'none' — for folder rows */
  folderCheckState: 'all' | 'some' | 'none';
}) {
  const { node, depth, isExpanded, hasChildren } = row;
  const isSymbol = !!node.nodeId;
  const isSelected = isSymbol && node.nodeId === selectedNodeId;
  const isInSubgraph = isSymbol && !!node.nodeId && subgraphNodeIds.has(node.nodeId);
  const isChecked = isSymbol && !!node.nodeId && checkedNodeIds.has(node.nodeId);
  const Icon = isSymbol
    ? getTypeIcon(node.kind)
    : hasChildren
      ? isExpanded
        ? FolderOpen
        : Folder
      : FileCode;
  const colorClass = isSymbol ? getTypeColor(node.kind) : 'text-muted-foreground';

  const handleClick = () => {
    if (isSymbol && node.nodeId) {
      onSelectNode(node.nodeId);
    } else if (hasChildren) {
      onToggleExpand(node.id);
    }
  };

  const paddingLeft = 8 + depth * 16;

  // Look up summary for directory/file nodes
  const summary = !isSymbol ? summaryMap.get(node.path) : undefined;

  const buttonEl = (
    <button
      ref={(el) => {
        if (el && node.nodeId) nodeRefs.current.set(node.nodeId, el);
        else if (!el && node.nodeId) nodeRefs.current.delete(node.nodeId);
      }}
      type="button"
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs transition-colors hover:bg-accent/50',
        isSelected && 'bg-accent text-accent-foreground',
        !isSelected && isInSubgraph && 'text-foreground font-medium',
        node.inSubgraph === false && 'opacity-40',
      )}
      style={{ paddingLeft, height: ROW_HEIGHT }}
    >
      {hasChildren && !isSymbol ? (
        <span className="shrink-0 w-3.5">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}

      {/* Checkbox: symbol nodes get individual check; folder/file nodes get select-all-children */}
      {isSymbol && (
        <button
          type="button"
          aria-label={isChecked ? 'Uncheck node' : 'Check node'}
          onClick={(e) => {
            e.stopPropagation();
            if (node.nodeId) onToggleCheck(node.nodeId);
          }}
          className="shrink-0 h-3.5 w-3.5 flex items-center justify-center rounded-sm hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          {isChecked ? (
            <CheckSquare className="h-3 w-3 text-primary" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      )}
      {!isSymbol && hasChildren && (
        <button
          type="button"
          aria-label={
            folderCheckState === 'all' ? 'Deselect all in folder' : 'Select all in folder'
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleFolderCheck(node.id);
          }}
          className="shrink-0 h-3.5 w-3.5 flex items-center justify-center rounded-sm hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          {folderCheckState === 'all' ? (
            <CheckSquare className="h-3 w-3 text-primary" />
          ) : folderCheckState === 'some' ? (
            <Minus className="h-3 w-3 text-primary" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      )}

      {node.communityColor ? (
        <span
          className="shrink-0 h-3 w-3 rounded-full border border-border/50"
          style={{ backgroundColor: node.communityColor }}
          aria-hidden
        />
      ) : (
        <Icon className={cn('h-3.5 w-3.5 shrink-0', colorClass)} />
      )}

      <span className={cn('truncate flex-1', !isSymbol && 'text-muted-foreground')}>
        {node.label}
      </span>

      {/* Community group: show member count badge */}
      {node.communityNodeCount != null && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
          {node.communityNodeCount}
        </span>
      )}

      {/* Subgraph indicator dot for symbols currently in AI subgraph */}
      {isInSubgraph && !isSelected && (
        <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary/70" />
      )}

      {node.lineStart != null && (
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">:{node.lineStart}</span>
      )}

      {(node.errorCount ?? 0) > 0 && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/20 text-[9px] text-red-500">
          {node.errorCount}
        </span>
      )}
    </button>
  );

  if (summary) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-72 text-xs">
          {summary}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (isSymbol) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{buttonEl}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-xs space-y-0.5">
          <div className="font-medium">{node.label}</div>
          <div className="text-muted-foreground capitalize">{node.kind}</div>
          {node.path && <div className="text-muted-foreground truncate">{node.path}</div>}
          {node.lineStart != null && (
            <div className="text-muted-foreground">Line {node.lineStart}</div>
          )}
          {node.inSubgraph === false && (
            <div className="text-amber-500/80 mt-0.5">Not in current graph view</div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return buttonEl;
});

/** Check if any descendant matches the search query */
function hasMatchingChild(node: FileTreeNode, query: string): boolean {
  for (const child of node.children) {
    if (child.label.toLowerCase().includes(query) || child.path.toLowerCase().includes(query)) {
      return true;
    }
    if (child.children.length > 0 && hasMatchingChild(child, query)) {
      return true;
    }
  }
  return false;
}

type GroupingMode = 'files' | 'communities';

/** Build a community-based tree from community data + ALL project nodes */
function buildCommunityTree(
  communities: Array<{ label: string; color: string; nodeIds: string[]; nodeCount: number }>,
  allNodesMap: Map<
    string,
    { id: string; type: string; name: string; file_path: string | null; line_start: number | null }
  >,
  subgraphNodeIds: Set<string>,
): FileTreeNode[] {
  return communities.map((c, idx) => {
    const children: FileTreeNode[] = [];
    for (const nid of c.nodeIds) {
      const n = allNodesMap.get(nid);
      if (!n) continue;
      children.push({
        id: `sym:${n.id}`,
        label: n.name,
        path: n.file_path ?? '',
        kind: n.type as FileTreeNode['kind'],
        nodeId: n.id,
        lineStart: n.line_start,
        children: [],
        // Store whether this community node is in the current canvas subgraph
        inSubgraph: subgraphNodeIds.has(n.id),
      });
    }
    children.sort((a, b) => a.label.localeCompare(b.label));

    return {
      id: `community:${idx}`,
      label: c.label,
      path: c.label,
      kind: 'dir' as const,
      communityColor: c.color,
      communityNodeCount: c.nodeCount,
      children,
    };
  });
}

/**
 * Build a lightweight FileTreeNode hierarchy from `getProjectTree` data.
 * Mirrors build-file-tree.ts logic but works on the stripped-down node shape.
 */
function buildProjectFileTree(
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    file_path: string | null;
    line_start: number | null;
  }>,
): FileTreeNode[] {
  const dirMap = new Map<string, FileTreeNode>();

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
    if (segments.length > 1) {
      const parentPath = segments.slice(0, -1).join('/');
      const parent = ensureDir(parentPath);
      if (!parent.children.some((c) => c.id === node.id)) parent.children.push(node);
    }
    return node;
  }

  for (const n of nodes) {
    if (!n.file_path) continue;
    const normalizedPath = n.file_path.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] ?? normalizedPath;
    const dirPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '.';
    const dir = ensureDir(dirPath);
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
    fileNode.children.push({
      id: `sym:${n.id}`,
      label: n.name,
      path: normalizedPath,
      kind: n.type as FileTreeNode['kind'],
      nodeId: n.id,
      lineStart: n.line_start,
      children: [],
    });
  }

  function sortTree(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.kind === 'dir' && b.kind !== 'dir') return -1;
      if (a.kind !== 'dir' && b.kind === 'dir') return 1;
      if (!a.nodeId && b.nodeId) return -1;
      if (a.nodeId && !b.nodeId) return 1;
      if (a.lineStart != null && b.lineStart != null) return a.lineStart - b.lineStart;
      return a.label.localeCompare(b.label);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortTree(node.children);
    }
  }

  const roots: FileTreeNode[] = [];
  for (const [path, node] of dirMap) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 1) roots.push(node);
  }
  if (roots.length === 0) roots.push(...dirMap.values());

  sortTree(roots);

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
      if (node.children.length > 0) node = { ...node, children: collapse(node.children) };
      return node;
    });
  }

  return collapse(roots);
}

/** Collect all descendant symbol node IDs (leaves with nodeId) under a tree node */
function getAllDescendantNodeIds(node: FileTreeNode): string[] {
  const ids: string[] = [];
  function walk(n: FileTreeNode) {
    if (n.nodeId) {
      ids.push(n.nodeId);
    }
    for (const child of n.children) {
      walk(child);
    }
  }
  walk(node);
  return ids;
}

/** AST Tree Sidebar — shows the project's code structure as a file tree */
export function AstTreeSidebar() {
  const subgraphNodes = useGraphStore((s) => s.nodes);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const [searchQuery, setSearchQuery] = useState('');
  const [grouping, setGrouping] = useState<GroupingMode>('files');
  const [checkedNodeIds, setCheckedNodeIds] = useState(new Set<string>());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const expandedInitRef = useRef(false);

  // Ref map from nodeId → virtualizer index, for auto-scroll
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fetch full project tree (all nodes, not just current subgraph)
  const projectTreeQuery = trpc.graph.getProjectTree.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, staleTime: 60_000, gcTime: 5 * 60_000 },
  );

  // Fetch summaries for directory/file tooltips
  const summariesQuery = trpc.graph.getSummaries.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, staleTime: 60_000 },
  );

  // Fetch communities when in community mode
  const communitiesQuery = trpc.graph.detectCommunities.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId && grouping === 'communities', staleTime: 60_000 },
  );

  // Fetch nodes + edges for "Render Selected" operation
  const utils = trpc.useUtils();
  const [isRendering, setIsRendering] = useState(false);

  const handleRenderSelected = useCallback(async () => {
    if (!projectId || checkedNodeIds.size === 0) return;
    setIsRendering(true);
    try {
      const checkedIds = [...checkedNodeIds];

      // Reuse the already-fetched project tree (from cache) to get node metadata
      const allNodes = await utils.graph.getProjectTree.fetch({ projectId });
      const checked = (allNodes.nodes ?? []).filter((n) => checkedIds.includes(n.id));

      // Build subgraph-shaped nodes
      const rfNodes = toOmniousNodes(
        checked.map((n) => ({
          id: n.id,
          oir_id: n.oir_id,
          type: n.type,
          name: n.name,
          file_path: n.file_path ?? '',
          line_start: n.line_start,
          line_end: null,
          signature: null,
          doc_comment: null,
          metadata: {},
          source: 'seed' as const,
        })),
      );

      // Fetch edges between selected nodes
      const edgesResult = await utils.graph.listEdges.fetch({ projectId, limit: 1000 });
      const selectedSet = new Set(checkedIds);
      const filteredEdges = (edgesResult.edges ?? []).filter(
        (e) => selectedSet.has(e.source_node_id) && selectedSet.has(e.target_node_id),
      );
      const rfEdges = toOmniousEdges(
        filteredEdges.map((e) => ({
          id: e.id,
          source_node_id: e.source_node_id,
          target_node_id: e.target_node_id,
          type: e.type,
          metadata: e.metadata as Record<string, unknown> | null,
        })),
      );

      useGraphStore.getState().setGraph(rfNodes, rfEdges);
    } finally {
      setIsRendering(false);
    }
  }, [projectId, checkedNodeIds, utils]);

  // Build summary path → text map
  const summaryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of summariesQuery.data?.summaries ?? []) {
      map.set(s.path, s.summary);
      if (s.path.endsWith('/')) map.set(s.path.slice(0, -1), s.summary);
    }
    return map;
  }, [summariesQuery.data]);

  // IDs of nodes currently in the AI subgraph (for highlighting)
  const subgraphNodeIds = useMemo(() => new Set(subgraphNodes.map((n) => n.id)), [subgraphNodes]);

  // Use full project tree when available; fall back to subgraph nodes
  const projectTreeNodes = projectTreeQuery.data?.nodes ?? [];
  const fullFileTree = useMemo(
    () =>
      projectTreeNodes.length > 0
        ? buildProjectFileTree(projectTreeNodes)
        : buildFileTree(subgraphNodes),
    [projectTreeNodes, subgraphNodes],
  );

  // Map from nodeId → node metadata — used by community tree to resolve all members
  const projectAllNodesMap = useMemo(
    () => new Map(projectTreeNodes.map((n) => [n.id, n])),
    [projectTreeNodes],
  );

  const communityTree = useMemo(
    () =>
      grouping === 'communities' && communitiesQuery.data
        ? buildCommunityTree(communitiesQuery.data.communities, projectAllNodesMap, subgraphNodeIds)
        : [],
    [grouping, communitiesQuery.data, projectAllNodesMap, subgraphNodeIds],
  );

  const tree = grouping === 'files' ? fullFileTree : communityTree;

  // Initialize expanded state once when tree first loads
  useEffect(() => {
    if (tree.length > 0 && !expandedInitRef.current) {
      expandedInitRef.current = true;
      setExpandedIds(collectInitialExpanded(tree, 2));
    }
  }, [tree]);

  // Flatten tree into visible rows for virtualizer
  const flatRows = useMemo(
    () => flattenTree(tree, expandedIds, searchQuery),
    [tree, expandedIds, searchQuery],
  );

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const selectedNodeId = useMemo(() => {
    const arr = Array.from(selectedNodeIds);
    return arr.length === 1 ? arr[0] : null;
  }, [selectedNodeIds]);

  // Auto-scroll to selected node when canvas selection changes
  useEffect(() => {
    if (!selectedNodeId) return;
    const idx = flatRows.findIndex((r) => r.node.nodeId === selectedNodeId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'auto', behavior: 'smooth' });
    }
  }, [selectedNodeId, flatRows, virtualizer]);

  // Auto-check nodes that enter the subgraph from an AI query
  // (marks them so user can see what was retrieved, without disturbing manual selections)
  useEffect(() => {
    if (subgraphNodes.length === 0) return;
    setCheckedNodeIds((prev) => {
      // Only add, never remove — user can uncheck manually
      const next = new Set(prev);
      for (const n of subgraphNodes) {
        if (n.data.source === 'seed') next.add(n.id);
      }
      return next;
    });
  }, [subgraphNodes]);

  const nodeCount =
    grouping === 'communities'
      ? (communitiesQuery.data?.communities.reduce((sum, c) => sum + c.nodeCount, 0) ?? 0)
      : projectTreeNodes.length || subgraphNodes.length;

  const onSelectNode = useCallback(
    (nodeId: string) => {
      useGraphStore.getState().selectNode(nodeId);
      useGraphStore.getState().highlightConnectedEdges(nodeId);
      useUIStore.getState().setDetailPanelOpen(true);

      // Zoom to the node if it's in the current subgraph
      if (subgraphNodeIds.has(nodeId)) {
        window.dispatchEvent(new CustomEvent('omnious:focus-node', { detail: { nodeId } }));
      }
    },
    [subgraphNodeIds],
  );

  const onToggleCheck = useCallback((nodeId: string) => {
    setCheckedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const onToggleExpand = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // All symbol IDs from the full project tree
  const allSymbolIds = useMemo(
    () => projectTreeNodes.filter((n) => n.id).map((n) => n.id),
    [projectTreeNodes],
  );

  const allChecked = allSymbolIds.length > 0 && allSymbolIds.every((id) => checkedNodeIds.has(id));
  const someChecked = !allChecked && allSymbolIds.some((id) => checkedNodeIds.has(id));

  const handleToggleSelectAll = useCallback(() => {
    if (allChecked) {
      setCheckedNodeIds(new Set());
    } else {
      setCheckedNodeIds(new Set(allSymbolIds));
    }
  }, [allChecked, allSymbolIds]);

  // Build a map from treeNodeId → 'all' | 'some' | 'none' for folder rows
  const folderCheckStateMap = useMemo(() => {
    const map = new Map<string, 'all' | 'some' | 'none'>();
    function computeState(node: FileTreeNode): 'all' | 'some' | 'none' {
      if (node.nodeId) {
        const checked = checkedNodeIds.has(node.nodeId);
        map.set(node.id, checked ? 'all' : 'none');
        return checked ? 'all' : 'none';
      }
      if (node.children.length === 0) {
        map.set(node.id, 'none');
        return 'none';
      }
      const childStates = node.children.map(computeState);
      const allAll = childStates.every((s) => s === 'all');
      const allNone = childStates.every((s) => s === 'none');
      const state = allAll ? 'all' : allNone ? 'none' : 'some';
      map.set(node.id, state);
      return state;
    }
    for (const root of tree) computeState(root);
    return map;
  }, [tree, checkedNodeIds]);

  // Find a FileTreeNode by id (shallow search over flat project data)
  const treeNodeById = useMemo(() => {
    const map = new Map<string, FileTreeNode>();
    function walk(nodes: FileTreeNode[]) {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children.length > 0) walk(n.children);
      }
    }
    walk(tree);
    return map;
  }, [tree]);

  const onToggleFolderCheck = useCallback(
    (nodeTreeId: string) => {
      const node = treeNodeById.get(nodeTreeId);
      if (!node) return;
      const descendantIds = getAllDescendantNodeIds(node);
      if (descendantIds.length === 0) return;
      const currentState = folderCheckStateMap.get(nodeTreeId) ?? 'none';
      setCheckedNodeIds((prev) => {
        const next = new Set(prev);
        if (currentState === 'all') {
          for (const id of descendantIds) next.delete(id);
        } else {
          for (const id of descendantIds) next.add(id);
        }
        return next;
      });
    },
    [treeNodeById, folderCheckStateMap],
  );

  return (
    <div className="flex h-full w-full flex-col border-r bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {grouping === 'files' ? (
            <FolderTree className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Network className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">
            {grouping === 'files' ? 'Explorer' : 'Communities'}
          </span>
          <span className="text-[10px] text-muted-foreground">({nodeCount})</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Select All */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={allChecked ? 'Deselect all' : 'Select all'}
                onClick={handleToggleSelectAll}
                className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {allChecked ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                ) : someChecked ? (
                  <Minus className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {allChecked ? 'Deselect all' : 'Select all'}
            </TooltipContent>
          </Tooltip>

          {/* Collapse All */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setExpandedIds(new Set())}
                aria-label="Collapse all folders"
              >
                <FoldVertical className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Collapse all</TooltipContent>
          </Tooltip>

          {/* Group by community / files toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={grouping === 'communities' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-6 w-6"
                onClick={() => setGrouping(grouping === 'files' ? 'communities' : 'files')}
              >
                <Network className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {grouping === 'files' ? 'Group by community' : 'Group by file'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      <div className="border-b px-2 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter symbols..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Render Selected bar — shown when there are checked nodes */}
      {checkedNodeIds.size > 0 && (
        <div className="flex items-center gap-2 border-b px-2 py-1.5 bg-accent/30">
          <Filter className="h-3 w-3 text-primary shrink-0" />
          <span className="text-[10px] text-muted-foreground flex-1">
            {checkedNodeIds.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-5 px-2 text-[10px]"
            disabled={isRendering}
            onClick={handleRenderSelected}
          >
            {isRendering ? 'Loading…' : 'Render'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => setCheckedNodeIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Tree (virtualized) */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {grouping === 'communities' && communitiesQuery.isLoading ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            Detecting communities...
          </div>
        ) : flatRows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {tree.length === 0 ? 'No nodes in graph' : 'No matching symbols'}
          </div>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index];
              return (
                <div
                  key={row.node.id}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <VirtualTreeRow
                    row={row}
                    selectedNodeId={selectedNodeId}
                    subgraphNodeIds={subgraphNodeIds}
                    checkedNodeIds={checkedNodeIds}
                    summaryMap={summaryMap}
                    nodeRefs={nodeRefs}
                    onSelectNode={onSelectNode}
                    onToggleCheck={onToggleCheck}
                    onToggleExpand={onToggleExpand}
                    onToggleFolderCheck={onToggleFolderCheck}
                    folderCheckState={folderCheckStateMap.get(row.node.id) ?? 'none'}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
