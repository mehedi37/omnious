import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

interface WorkerNode {
  id: string;
  width: number;
  height: number;
  group?: string; // directory group for compound layout
}

interface WorkerEdge {
  id: string;
  source: string;
  target: string;
}

interface LayoutRequest {
  requestId: number;
  nodes: WorkerNode[];
  edges: WorkerEdge[];
  layoutMode: 'layered-tb' | 'layered-lr' | 'force' | 'stress';
}

/** Threshold above which we switch to faster algorithms */
const LARGE_GRAPH_THRESHOLD = 200;

const LAYOUT_OPTIONS: Record<string, Record<string, string>> = {
  'layered-tb': {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.spacing.nodeNode': '180',
    'elk.layered.spacing.nodeNodeBetweenLayers': '200',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.edgeRouting': 'SPLINES',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
  },
  'layered-lr': {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '180',
    'elk.layered.spacing.nodeNodeBetweenLayers': '220',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.edgeRouting': 'SPLINES',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
  },
  force: {
    'elk.algorithm': 'force',
    'elk.spacing.nodeNode': '180',
    'elk.force.temperature': '0.001',
    'elk.force.iterations': '120',
  },
  stress: {
    'elk.algorithm': 'stress',
    'elk.spacing.nodeNode': '180',
    'elk.stress.desiredEdgeLength': '240',
  },
};

/**
 * For large graphs (>200 nodes) with layered layout, override to use faster
 * INTERACTIVE crossing minimization and polyline edge routing.
 */
const LARGE_GRAPH_LAYERED_OVERRIDES: Record<string, string> = {
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
  'elk.edgeRouting': 'POLYLINE',
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
};

function getOptions(layoutMode: string, nodeCount: number): Record<string, string> {
  const base = LAYOUT_OPTIONS[layoutMode] ?? LAYOUT_OPTIONS['layered-tb'];

  // For large graphs with layered algorithm, use faster overrides
  if (
    nodeCount > LARGE_GRAPH_THRESHOLD &&
    (layoutMode === 'layered-tb' || layoutMode === 'layered-lr')
  ) {
    return { ...base, ...LARGE_GRAPH_LAYERED_OVERRIDES };
  }

  return base;
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const { requestId, nodes, edges, layoutMode } = event.data;
  const options = getOptions(layoutMode, nodes.length);

  try {
    // For small graphs, skip compound grouping — flat layout is faster
    const hasGroups = nodes.length >= 10 && nodes.some((n) => n.group);

    console.time(`[elk] layout requestId=${requestId} nodes=${nodes.length}`);
    let elkGraph: ElkNode;
    if (hasGroups) {
      // Build compound layout: group nodes by directory into compound parent nodes
      const groupMap = new Map<string, WorkerNode[]>();
      const ungrouped: WorkerNode[] = [];

      for (const node of nodes) {
        if (node.group) {
          const arr = groupMap.get(node.group) ?? [];
          arr.push(node);
          groupMap.set(node.group, arr);
        } else {
          ungrouped.push(node);
        }
      }

      const compoundChildren = [
        // Compound group nodes containing their children
        ...Array.from(groupMap.entries()).map(([groupId, children]) => ({
          id: groupId,
          layoutOptions: {
            'elk.padding': '[top=30,left=15,bottom=15,right=15]',
            'elk.algorithm': 'layered',
            'elk.direction': layoutMode === 'layered-lr' ? 'RIGHT' : 'DOWN',
            'elk.spacing.nodeNode': '80',
            'elk.layered.spacing.nodeNodeBetweenLayers': '100',
          },
          children: children.map((n) => ({
            id: n.id,
            width: n.width,
            height: n.height,
          })),
        })),
        // Ungrouped nodes at root level
        ...ungrouped.map((n) => ({
          id: n.id,
          width: n.width,
          height: n.height,
        })),
      ];

      elkGraph = await elk.layout({
        id: 'root',
        layoutOptions: {
          ...options,
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        },
        children: compoundChildren,
        edges: edges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      });
    } else {
      elkGraph = await elk.layout({
        id: 'root',
        layoutOptions: options,
        children: nodes.map((n) => ({
          id: n.id,
          width: n.width,
          height: n.height,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      });
    }

    // Extract positions — handle both flat and compound layouts
    const positions: Array<{ id: string; x: number; y: number }> = [];

    function extractPositions(children: typeof elkGraph.children, offsetX = 0, offsetY = 0) {
      for (const child of children ?? []) {
        const cx = (child.x ?? 0) + offsetX;
        const cy = (child.y ?? 0) + offsetY;
        // If it has children, it's a compound node — recurse
        if ((child as any).children?.length > 0) {
          extractPositions((child as any).children, cx, cy);
        } else {
          positions.push({ id: child.id, x: cx, y: cy });
        }
      }
    }

    extractPositions(elkGraph.children);

    // Extract ELK-computed edge routes (bend points) for node-avoiding paths
    const edgeRoutes: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];

    function extractEdgeRoutes(edges: typeof elkGraph.edges, offsetX = 0, offsetY = 0) {
      for (const edge of edges ?? []) {
        for (const section of (edge as any).sections ?? []) {
          const points: Array<{ x: number; y: number }> = [];
          if (section.startPoint) {
            points.push({
              x: (section.startPoint.x ?? 0) + offsetX,
              y: (section.startPoint.y ?? 0) + offsetY,
            });
          }
          for (const bp of section.bendPoints ?? []) {
            points.push({ x: bp.x + offsetX, y: bp.y + offsetY });
          }
          if (section.endPoint) {
            points.push({
              x: (section.endPoint.x ?? 0) + offsetX,
              y: (section.endPoint.y ?? 0) + offsetY,
            });
          }
          if (points.length >= 2) {
            edgeRoutes.push({ id: edge.id, points });
          }
        }
      }
    }

    // Root-level edges
    extractEdgeRoutes(elkGraph.edges);

    // Edges within compound (group) nodes — offset by the group's position
    for (const child of elkGraph.children ?? []) {
      if ((child as any).children?.length > 0) {
        extractEdgeRoutes((child as any).edges, child.x ?? 0, child.y ?? 0);
      }
    }

    console.timeEnd(`[elk] layout requestId=${requestId} nodes=${nodes.length}`);
    self.postMessage({ requestId, positions, edgeRoutes });
  } catch (error) {
    console.timeEnd(`[elk] layout requestId=${requestId} nodes=${nodes.length}`);
    self.postMessage({ requestId, positions: [], edgeRoutes: [], error: String(error) });
  }
};
