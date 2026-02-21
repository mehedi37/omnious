import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

interface WorkerNode {
  id: string;
  width: number;
  height: number;
}

interface WorkerEdge {
  id: string;
  source: string;
  target: string;
}

interface LayoutRequest {
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
    'elk.spacing.nodeNode': '120',
    'elk.layered.spacing.nodeNodeBetweenLayers': '140',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  },
  'layered-lr': {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '120',
    'elk.layered.spacing.nodeNodeBetweenLayers': '140',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  },
  force: {
    'elk.algorithm': 'force',
    'elk.spacing.nodeNode': '140',
    'elk.force.temperature': '0.001',
    'elk.force.iterations': '100',
  },
  stress: {
    'elk.algorithm': 'stress',
    'elk.spacing.nodeNode': '140',
    'elk.stress.desiredEdgeLength': '200',
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
  if (nodeCount > LARGE_GRAPH_THRESHOLD && (layoutMode === 'layered-tb' || layoutMode === 'layered-lr')) {
    return { ...base, ...LARGE_GRAPH_LAYERED_OVERRIDES };
  }

  return base;
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges, layoutMode } = event.data;
  const options = getOptions(layoutMode, nodes.length);

  try {
    const graph = await elk.layout({
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

    const positions = (graph.children ?? []).map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
    }));

    self.postMessage({ positions });
  } catch (error) {
    self.postMessage({ positions: [], error: String(error) });
  }
};
