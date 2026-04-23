/**
 * D3 force simulation factory.
 *
 * Creates a d3-force simulation tuned for 10k+ code graph nodes.
 * Barnes-Hut many-body approximation (θ=0.9) keeps each tick under ~2ms
 * even with large graphs. Layout biases for layered modes use BFS topological
 * depth to stratify nodes along the primary axis.
 */

import * as d3 from 'd3';
import dagre from '@dagrejs/dagre';
import type { D3SimNode, D3SimLink } from './types';
import type { OmniousEdge } from '@/lib/stores/graph-store';

export type LayoutMode = 'layered-tb' | 'layered-lr' | 'force' | 'stress' | 'structure' | 'dagre';

// ─── Topological depth BFS ────────────────────────────────────────────────

function computeTopologicalDepths(
  nodes: D3SimNode[],
  edges: OmniousEdge[],
): Map<string, number> {
  const depths = new Map<string, number>();
  // Build adjacency (outgoing edges: source → [target])
  const adj = new Map<string, string[]>();
  const incoming = new Map<string, number>();

  for (const n of nodes) {
    adj.set(n.id, []);
    incoming.set(n.id, 0);
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  }

  // Roots: nodes with no incoming edges
  const queue: string[] = [];
  for (const n of nodes) {
    if ((incoming.get(n.id) ?? 0) === 0) {
      depths.set(n.id, 0);
      queue.push(n.id);
    }
  }

  // BFS layering
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const depth = depths.get(nodeId) ?? 0;
    for (const neighbor of adj.get(nodeId) ?? []) {
      const existing = depths.get(neighbor);
      if (existing === undefined || existing < depth + 1) {
        depths.set(neighbor, depth + 1);
        queue.push(neighbor);
      }
    }
  }

  // Assign depth 0 to any unvisited node (disconnected components)
  for (const n of nodes) {
    if (!depths.has(n.id)) depths.set(n.id, 0);
  }

  return depths;
}

// ─── Simulation factory ────────────────────────────────────────────────────

export function createSimulation(
  nodes: D3SimNode[],
  links: D3SimLink[],
  edges: OmniousEdge[],
  layoutMode: LayoutMode,
  canvasWidth: number,
  canvasHeight: number,
): d3.Simulation<D3SimNode, D3SimLink> {
  const isLarge = nodes.length > 500;
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  // ── Base forces ──────────────────────────────────────────────────────────

  const linkForce = d3
    .forceLink<D3SimNode, D3SimLink>(links)
    .id((d) => d.id)
    .distance((l) => {
      // Longer distance for structural nodes to create breathing room
      const src = l.source as D3SimNode;
      const tgt = l.target as D3SimNode;
      const isStructural =
        src.oirType === 'module' ||
        src.oirType === 'package' ||
        tgt.oirType === 'module' ||
        tgt.oirType === 'package';
      return isStructural ? 180 : 120;
    })
    .strength(0.4);

  const chargeForce = d3
    .forceManyBody<D3SimNode>()
    .strength(isLarge ? -200 : -300)
    .theta(0.9) // Barnes-Hut approximation — critical for performance
    .distanceMax(isLarge ? 600 : 800);

  const centerForce = d3.forceCenter<D3SimNode>(cx, cy).strength(0.05);

  const collideForce = d3
    .forceCollide<D3SimNode>((d) => d.width / 2 + 14)
    .strength(0.7)
    .iterations(2);

  const sim = d3
    .forceSimulation<D3SimNode, D3SimLink>(nodes)
    .force('link', linkForce)
    .force('charge', chargeForce)
    .force('center', centerForce)
    .force('collide', collideForce)
    .alphaDecay(isLarge ? 0.04 : 0.028)
    .velocityDecay(isLarge ? 0.5 : 0.4)
    .stop(); // Don't auto-start — caller controls tick/start

  // ── Layout mode biases ───────────────────────────────────────────────────

  if (layoutMode === 'layered-tb' || layoutMode === 'layered-lr') {
    const depths = computeTopologicalDepths(nodes, edges);
    const maxDepth = Math.max(1, ...depths.values());

    if (layoutMode === 'layered-tb') {
      const layerH = Math.min(200, (canvasHeight * 0.8) / (maxDepth + 1));
      sim.force(
        'layerY',
        d3
          .forceY<D3SimNode>((d) => {
            const depth = depths.get(d.id) ?? 0;
            return cy - (canvasHeight * 0.4) + depth * layerH;
          })
          .strength(0.3),
      );
    } else {
      const layerW = Math.min(240, (canvasWidth * 0.8) / (maxDepth + 1));
      sim.force(
        'layerX',
        d3
          .forceX<D3SimNode>((d) => {
            const depth = depths.get(d.id) ?? 0;
            return cx - (canvasWidth * 0.4) + depth * layerW;
          })
          .strength(0.3),
      );
    }
  } else if (layoutMode === 'stress') {
    // Stress minimization: weaker charge, longer desired edge distance
    (sim.force('charge') as d3.ForceManyBody<D3SimNode>).strength(-150);
    (sim.force('link') as d3.ForceLink<D3SimNode, D3SimLink>).distance(240).strength(0.2);
  } else if (layoutMode === 'structure') {
    // File-tree structure mode: group nodes by top-level directory on X axis,
    // BFS call-graph depth on Y axis — addresses the "hairball" problem.
    const depths = computeTopologicalDepths(nodes, edges);
    const maxDepth = Math.max(1, ...depths.values());

    // Collect unique top-level directories
    const dirSet = new Set<string>();
    for (const n of nodes) {
      const parts = (n.filePath ?? '').split('/');
      // Use the second segment (after 'src' etc.) if available, else first
      const key = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0] ?? 'root';
      dirSet.add(key);
    }
    const dirs = [...dirSet].sort();
    const dirIndex = new Map(dirs.map((d, i) => [d, i]));
    const dirSpacing = canvasWidth / Math.max(1, dirs.length);

    sim.force(
      'structureX',
      d3
        .forceX<D3SimNode>((d) => {
          const parts = (d.filePath ?? '').split('/');
          const key = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0] ?? 'root';
          const idx = dirIndex.get(key) ?? 0;
          return (idx + 0.5) * dirSpacing - canvasWidth / 2 + cx;
        })
        .strength(0.25),
    );
    sim.force(
      'structureY',
      d3
        .forceY<D3SimNode>((d) => {
          const depth = depths.get(d.id) ?? 0;
          const layerH = Math.min(180, (canvasHeight * 0.8) / (maxDepth + 1));
          return cy - canvasHeight * 0.35 + depth * layerH;
        })
        .strength(0.25),
    );
    (sim.force('charge') as d3.ForceManyBody<D3SimNode>).strength(-180);
  } else if (layoutMode === 'dagre') {
    // Exact DAG layout using dagre — positions are pinned (fx/fy) so physics won't move them.
    // The simulation still runs for collision avoidance via the collide force.
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 });

    for (const n of nodes) {
      g.setNode(n.id, { width: n.width ?? 140, height: 50 });
    }
    for (const e of edges) {
      g.setEdge(e.source, e.target);
    }

    dagre.layout(g);

    // Centre the dagre layout on the canvas
    const graphInfo = g.graph();
    const gw = (graphInfo.width ?? 0) as number;
    const gh = (graphInfo.height ?? 0) as number;
    const offsetX = cx - gw / 2;
    const offsetY = cy - gh / 2;

    for (const n of nodes) {
      const pos = g.node(n.id);
      if (pos) {
        n.fx = pos.x + offsetX;
        n.fy = pos.y + offsetY;
      }
    }

    // No positional forces needed — positions are fixed; keep only collision.
    sim.force('charge', null);
    sim.force('center', null);
    sim.force('link', null);
  }

  return sim;
}

// ─── Background pre-settling ─────────────────────────────────────────────

/**
 * Run the simulation to near-completion synchronously in batched chunks
 * so positions stabilize before the first render (avoids "big bang" explosion).
 * Uses setTimeout(0) scheduling to yield to the browser between batches.
 */
export function preSettleSimulation(
  sim: d3.Simulation<D3SimNode, D3SimLink>,
  onDone: () => void,
  ticksPerBatch = 20,
  maxTicks = 300,
): void {
  let ticked = 0;
  sim.alpha(1).restart();

  function batch() {
    for (let i = 0; i < ticksPerBatch && sim.alpha() > sim.alphaMin(); i++) {
      sim.tick();
      ticked++;
    }
    if (ticked < maxTicks && sim.alpha() > sim.alphaMin()) {
      setTimeout(batch, 0);
    } else {
      sim.stop();
      onDone();
    }
  }

  setTimeout(batch, 0);
}
