/**
 * D3 edge renderer — Canvas 2D drawing for Omnious code graph edges.
 *
 * Uses cubic bezier curves with a slight curvature offset for visual clarity.
 * Arrowheads are drawn at the target node boundary (clipped correctly).
 * Animated flow dots move along active edges during trace replay.
 */

import type { D3SimLink, GraphVisualState, LODLevel } from './types';
import type { OIREdgeType } from '@/lib/oir/types';

// ─── Edge colors ───────────────────────────────────────────────────────────

type EdgeStyle = { color: string; width: number; dash: number[] };

const EDGE_STYLES: Record<OIREdgeType | 'runtime_call', EdgeStyle> = {
  calls:         { color: '#4ade80', width: 1.8, dash: [] },
  renders:       { color: '#60a5fa', width: 1.8, dash: [] },
  routes_to:     { color: '#fb923c', width: 1.6, dash: [] },
  queries:       { color: '#c084fc', width: 1.6, dash: [] },
  emits_event:   { color: '#22d3ee', width: 1.4, dash: [] },
  subscribes_to: { color: '#2dd4bf', width: 1.4, dash: [] },
  redirects_to:  { color: '#fbbf24', width: 1.4, dash: [] },
  uses:          { color: '#818cf8', width: 1.3, dash: [5, 3] },
  imports:       { color: '#4b5a7a', width: 1.1, dash: [4, 4] },
  exports:       { color: '#4b5a7a', width: 1.1, dash: [4, 4] },
  extends:       { color: '#374569', width: 1.0, dash: [6, 4] },
  implements:    { color: '#2a3454', width: 1.0, dash: [6, 4] },
  runtime_call:  { color: '#fbbf24', width: 2.2, dash: [] },
};

const FALLBACK_STYLE: EdgeStyle = { color: '#334155', width: 1, dash: [] };

function getEdgeStyle(edgeType: string): EdgeStyle {
  return EDGE_STYLES[edgeType as OIREdgeType | 'runtime_call'] ?? FALLBACK_STYLE;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Compute bezier control points for a curved edge.
 * Uses a curvature factor so parallel edges are visually distinct.
 */
function getBezierPoints(
  sx: number, sy: number,
  tx: number, ty: number,
  curvature = 0.3,
): { cpx1: number; cpy1: number; cpx2: number; cpy2: number } {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 1) return { cpx1: sx, cpy1: sy, cpx2: tx, cpy2: ty };

  // Perpendicular offset for curvature
  const nx = -dy / len;
  const ny = dx / len;
  const offset = len * curvature * 0.5;

  return {
    cpx1: sx + dx * 0.33 + nx * offset,
    cpy1: sy + dy * 0.33 + ny * offset,
    cpx2: tx - dx * 0.33 + nx * offset,
    cpy2: ty - dy * 0.33 + ny * offset,
  };
}

/** Clamp a point to the node boundary so arrows don't overlap the node */
function nodeEdgePoint(
  cx: number, cy: number,
  nw: number, nh: number,
  px: number, py: number,
): { x: number; y: number } {
  const dx = px - cx;
  const dy = py - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const hw = nw / 2;
  const hh = nh / 2;
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);

  return { x: cx + dx * t, y: cy + dy * t };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ─── Point along a cubic bezier (for flow animation) ──────────────────────

function cubicBezierPoint(
  t: number,
  sx: number, sy: number,
  cpx1: number, cpy1: number,
  cpx2: number, cpy2: number,
  tx: number, ty: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * sx + 3 * mt2 * t * cpx1 + 3 * mt * t2 * cpx2 + t3 * tx,
    y: mt3 * sy + 3 * mt2 * t * cpy1 + 3 * mt * t2 * cpy2 + t3 * ty,
  };
}

// ─── Public: draw a single edge ────────────────────────────────────────────

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  link: D3SimLink,
  visualState: GraphVisualState,
  lod: LODLevel,
): void {
  const src = link.source;
  const tgt = link.target;

  if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) {
    return;
  }

  const edgeType = link.data?.edgeType ?? 'calls';
  const isHovered = visualState.hoveredEdgeId === link.id;
  const isActiveFlow = visualState.activeEdgeIds.has(link.id);
  const isErrorFlow = visualState.errorFlowEdgeIds.has(link.id);
  const isHighlighted = isHovered || isActiveFlow || isErrorFlow;

  // Skip low-visibility edges in dot mode (only show important edges)
  if (lod === 'dot') {
    const edgeStyle = getEdgeStyle(edgeType);
    if (edgeStyle.dash.length > 0 && !isHighlighted) return;
  }

  // Compute boundary attachment points
  const srcPt = nodeEdgePoint(src.x, src.y, src.width, src.height, tgt.x, tgt.y);
  const tgtPt = nodeEdgePoint(tgt.x, tgt.y, tgt.width, tgt.height, src.x, src.y);

  const { cpx1, cpy1, cpx2, cpy2 } = getBezierPoints(
    srcPt.x, srcPt.y,
    tgtPt.x, tgtPt.y,
  );

  const style = getEdgeStyle(edgeType);

  // Determine effective color/width
  let strokeColor = style.color;
  let lineWidth = style.width;

  if (isErrorFlow) {
    strokeColor = '#ef4444';
    lineWidth = Math.max(lineWidth, 2);
  } else if (isActiveFlow) {
    strokeColor = '#fbbf24';
    lineWidth = Math.max(lineWidth, 2);
  } else if (isHovered) {
    strokeColor = style.color;
    lineWidth = lineWidth * 1.8;
  }

  const opacity = (() => {
    if (isHighlighted) return 1.0;
    if (visualState.focusedNodeId !== null) {
      if (
        src.id !== visualState.focusedNodeId &&
        tgt.id !== visualState.focusedNodeId &&
        !visualState.connectedNodeIds.has(src.id) &&
        !visualState.connectedNodeIds.has(tgt.id)
      ) {
        return 0.04;
      }
    }
    return 0.72;
  })();

  ctx.globalAlpha = opacity;

  // Error flow glow
  if (isErrorFlow) {
    ctx.shadowColor = 'rgba(239,68,68,0.5)';
    ctx.shadowBlur = 6;
  }

  ctx.beginPath();
  ctx.moveTo(srcPt.x, srcPt.y);
  ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, tgtPt.x, tgtPt.y);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;

  if (style.dash.length > 0 && !isHighlighted) {
    ctx.setLineDash(style.dash);
  } else {
    ctx.setLineDash([]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  // Arrowhead
  if (lod !== 'dot') {
    const arrowAngle = Math.atan2(tgtPt.y - cpy2, tgtPt.x - cpx2);
    const arrowSize = isHighlighted ? 9 : 7;
    drawArrow(ctx, tgtPt.x, tgtPt.y, arrowAngle, arrowSize, strokeColor);
  }

  ctx.globalAlpha = 1;
}

// ─── Flow animation dot ────────────────────────────────────────────────────

export function drawFlowDot(
  ctx: CanvasRenderingContext2D,
  link: D3SimLink,
  t: number,
): void {
  const src = link.source;
  const tgt = link.target;
  if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) {
    return;
  }

  const srcPt = nodeEdgePoint(src.x, src.y, src.width, src.height, tgt.x, tgt.y);
  const tgtPt = nodeEdgePoint(tgt.x, tgt.y, tgt.width, tgt.height, src.x, src.y);
  const { cpx1, cpy1, cpx2, cpy2 } = getBezierPoints(srcPt.x, srcPt.y, tgtPt.x, tgtPt.y);

  const pt = cubicBezierPoint(t, srcPt.x, srcPt.y, cpx1, cpy1, cpx2, cpy2, tgtPt.x, tgtPt.y);

  // Glow halo
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251,191,36,0.3)';
  ctx.fill();

  // Core dot
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
}
