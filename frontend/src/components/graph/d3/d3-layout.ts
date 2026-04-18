/**
 * D3 force simulation factory.
 *
 * Creates a d3-force simulation tuned for 10k+ code graph nodes.
 * Barnes-Hut many-body approximation (θ=0.9) keeps each tick under ~2ms
 * even with large graphs. Layout biases for layered modes use BFS topological
 * depth to stratify nodes along the primary axis.
 */

import * as d3 from 'd3';
import type { D3SimNode, D3SimLink } from './types';
import type { OmniousEdge } from '@/lib/stores/graph-store';

export type LayoutMode = 'layered-tb' | 'layered-lr' | 'force' | 'stress';

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
