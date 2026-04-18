/**
 * D3 interactions — zoom behavior and hit-testing utilities.
 *
 * Creates a d3-zoom behavior wired to a canvas element, and provides
 * O(log n) pointer→node resolution using a d3.quadtree.
 * Also handles edge proximity hit testing for hover highlighting.
 */

import * as d3 from 'd3';
import type { D3SimNode, D3SimLink } from './types';

// ─── Zoom behavior ────────────────────────────────────────────────────────

export function createZoomBehavior(
  canvas: HTMLCanvasElement,
  onTransformChange: (t: d3.ZoomTransform) => void,
): d3.ZoomBehavior<HTMLCanvasElement, unknown> {
  const zoom = d3
    .zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.05, 8])
    .filter((event: Event) => {
      // Allow wheel zoom; allow drag pan only on non-node pointerdown
      if (event.type === 'wheel') return true;
      if (event.type === 'dblclick') return false; // handled separately
      return true;
    })
    .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      onTransformChange(event.transform);
    });

  d3.select(canvas).call(zoom);
  return zoom;
}

// ─── Quadtree ──────────────────────────────────────────────────────────────

export function buildQuadtree(nodes: D3SimNode[]): d3.Quadtree<D3SimNode> {
  return d3
    .quadtree<D3SimNode>()
    .x((d) => d.x ?? 0)
    .y((d) => d.y ?? 0)
    .addAll(nodes);
}

/**
 * Find the nearest node to a world-space pointer position.
 * Returns null if no node is within the hit radius.
 */
export function hitTestNode(
  qt: d3.Quadtree<D3SimNode>,
  worldX: number,
  worldY: number,
  visualFilters?: { nodeTypeFilters?: Set<string>; focusedNodeId?: string | null; connectedNodeIds?: Set<string> },
): D3SimNode | null {
  // Search a radius that accounts for the largest node width/2 + some tolerance
  const searchRadius = 130;
  let found: D3SimNode | null = null;
  let bestDistSq = Infinity;

  qt.visit((node, x1, y1, x2, y2) => {
    // Prune quadtree branches that are definitely too far
    const dx = Math.max(x1 - worldX, 0, worldX - x2);
    const dy = Math.max(y1 - worldY, 0, worldY - y2);
    if (dx * dx + dy * dy > searchRadius * searchRadius) return true;

    if (!node.length) {
      // Leaf node — check all data points in this leaf
      let d: d3.QuadtreeLeaf<D3SimNode> | undefined = node;
      while (d) {
        const sim = d.data;
        const nx = sim.x ?? 0;
        const ny = sim.y ?? 0;
        const hw = sim.width / 2;
        const hh = sim.height / 2;

        // Rect hit test
        if (
          worldX >= nx - hw && worldX <= nx + hw &&
          worldY >= ny - hh && worldY <= ny + hh
        ) {
          const distSq = (worldX - nx) ** 2 + (worldY - ny) ** 2;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            found = sim;
          }
        }
        d = d.next;
      }
    }
    return false;
  });

  return found;
}

/**
 * Find the nearest edge within a pixel threshold of the pointer.
 * Uses sampling along bezier curves. Returns null if none found.
 */
export function hitTestEdge(
  links: D3SimLink[],
  worldX: number,
  worldY: number,
  threshold = 8,
): D3SimLink | null {
  let found: D3SimLink | null = null;
  let bestDist = threshold;

  for (const link of links) {
    const src = link.source;
    const tgt = link.target;
    if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) {
      continue;
    }

    // Quick bounding box pre-check
    const minX = Math.min(src.x, tgt.x) - threshold;
    const maxX = Math.max(src.x, tgt.x) + threshold;
    const minY = Math.min(src.y, tgt.y) - threshold;
    const maxY = Math.max(src.y, tgt.y) + threshold;
    if (worldX < minX || worldX > maxX || worldY < minY || worldY > maxY) continue;

    // Sample 12 points along the bezier
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = len > 0 ? -dy / len * len * 0.15 : 0;
    const ny = len > 0 ? dx / len * len * 0.15 : 0;

    const cpx1 = src.x + dx * 0.33 + nx * 0.5;
    const cpy1 = src.y + dy * 0.33 + ny * 0.5;
    const cpx2 = tgt.x - dx * 0.33 + nx * 0.5;
    const cpy2 = tgt.y - dy * 0.33 + ny * 0.5;

    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const mt = 1 - t;
      const bx = mt * mt * mt * src.x + 3 * mt * mt * t * cpx1 + 3 * mt * t * t * cpx2 + t * t * t * tgt.x;
      const by = mt * mt * mt * src.y + 3 * mt * mt * t * cpy1 + 3 * mt * t * t * cpy2 + t * t * t * tgt.y;
      const dist = Math.sqrt((worldX - bx) ** 2 + (worldY - by) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        found = link;
      }
    }
  }

  return found;
}

// ─── Coordinate transform ─────────────────────────────────────────────────

/** Convert canvas-space (client) coords to world-space using d3 zoom transform */
export function canvasToWorld(
  transform: d3.ZoomTransform,
  canvasX: number,
  canvasY: number,
): { x: number; y: number } {
  return {
    x: (canvasX - transform.x) / transform.k,
    y: (canvasY - transform.y) / transform.k,
  };
}

/** Get bounding box in world space for the current transform + canvas size */
export function viewportBounds(
  transform: d3.ZoomTransform,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const tl = canvasToWorld(transform, 0, 0);
  const br = canvasToWorld(transform, width, height);
  return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
}
