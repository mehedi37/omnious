/**
 * D3 node renderer — Canvas 2D drawing for Omnious code nodes.
 *
 * Three LOD levels:
 *  dot  (zoom < 0.25)  — coloured circle with glow halo
 *  pill (0.25–0.6)     — rounded card with icon badge, name, error chip
 *  card (≥ 0.6)        — full card: gradient bg, icon circle, name, filepath, doc snippet
 *
 * All drawing is done in world space (before zoom transform). The caller
 * is responsible for ctx.save() / ctx.restore() around the zoom transform.
 */

import type { D3SimNode, GraphVisualState, LODLevel, CanvasTheme } from './types';
import type { OIRNodeType } from '@/lib/oir/types';

// ─── Node type accent colors — vibrant on dark ────────────────────────────

const TYPE_COLORS: Record<OIRNodeType, string> = {
  function:       '#4ade80', // vivid green
  component:      '#60a5fa', // vivid blue
  route:          '#fb923c', // vivid orange
  database_query: '#c084fc', // vivid purple
  module:         '#94a3b8', // cool slate
  class:          '#818cf8', // vivid indigo
  middleware:     '#fbbf24', // vivid amber
  event_emitter:  '#22d3ee', // vivid cyan
  event_listener: '#2dd4bf', // vivid teal
  external_api:   '#f472b6', // vivid pink
  variable:       '#6b7280', // muted gray
  type_def:       '#a78bfa', // vivid violet
  struct:         '#34d399', // vivid emerald
  enum:           '#a3e635', // vivid lime
  interface:      '#5eead4', // vivid teal-blue
  namespace:      '#9ca3af', // light gray
  trait:          '#fb7185', // vivid rose
  protocol:       '#38bdf8', // vivid sky
  package:        '#a5b4fc', // light indigo
};

/** Unicode icon glyphs — rendered in the node icon circle */
const TYPE_ICONS: Record<OIRNodeType, string> = {
  function:       'λ',
  component:      '◈',
  route:          '⇝',
  database_query: '⊟',
  module:         '⊞',
  class:          '◆',
  middleware:     '⧸',
  event_emitter:  '⊛',
  event_listener: '◎',
  external_api:   '⟲',
  variable:       'v',
  type_def:       'T',
  struct:         '▦',
  enum:           '≡',
  interface:      'I',
  namespace:      'N',
  trait:          '◇',
  protocol:       '⊕',
  package:        '⬡',
};

// ─── Heatmap colors ────────────────────────────────────────────────────────

function heatColor(heatLevel: string): string {
  switch (heatLevel) {
    case 'low':      return 'rgba(234,179,8,0.15)';
    case 'medium':   return 'rgba(249,115,22,0.22)';
    case 'high':     return 'rgba(239,68,68,0.30)';
    case 'critical': return 'rgba(220,38,38,0.45)';
    default:         return 'transparent';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── DOT ──────────────────────────────────────────────────────────────────

function drawDot(
  ctx: CanvasRenderingContext2D,
  node: D3SimNode,
  x: number, y: number,
  color: string,
  isSelected: boolean,
  isDimmed: boolean,
): void {
  const r = 7;
  ctx.globalAlpha = isDimmed ? 0.05 : 1;

  if (isSelected) {
    // Outer glow ring
    const grd = ctx.createRadialGradient(x, y, r, x, y, r + 10);
    grd.addColorStop(0, hexToRgba(color, 0.4));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(x, y, r + 10, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowBlur = 0;

  if (isSelected) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

// ─── Icon circle helper ────────────────────────────────────────────────────

function drawIconCircle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  r: number,
  color: string,
  icon: string,
  iconSize: number,
): void {
  // Circle fill
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(color, 0.18);
  ctx.fill();
  // Circle border
  ctx.strokeStyle = hexToRgba(color, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  // Icon
  ctx.font = `${iconSize}px "Geist Mono","JetBrains Mono",monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, cx, cy + 0.5);
}

// ─── PILL ─────────────────────────────────────────────────────────────────

function drawPill(
  ctx: CanvasRenderingContext2D,
  node: D3SimNode,
  x: number, y: number,
  w: number, h: number,
  color: string,
  theme: CanvasTheme,
  isSelected: boolean,
  isDimmed: boolean,
  isHeatmap: boolean,
  heatLevel: string,
): void {
  const rx = x - w / 2;
  const ry = y - h / 2;

  ctx.globalAlpha = isDimmed ? 0.05 : 1;

  // Background
  roundedRect(ctx, rx, ry, w, h, 7);
  ctx.fillStyle = theme.nodeBg;
  ctx.fill();

  // Subtle top-edge color accent line
  ctx.beginPath();
  ctx.moveTo(rx + 10, ry + 1);
  ctx.lineTo(rx + w - 10, ry + 1);
  ctx.strokeStyle = hexToRgba(color, 0.6);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Heatmap tint
  if (isHeatmap && heatLevel !== 'none') {
    roundedRect(ctx, rx, ry, w, h, 7);
    ctx.fillStyle = heatColor(heatLevel);
    ctx.fill();
  }

  // Border
  roundedRect(ctx, rx, ry, w, h, 7);
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  }
  ctx.strokeStyle = isSelected ? color : hexToRgba(color, 0.25);
  ctx.lineWidth = isSelected ? 1.5 : 0.75;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Icon circle
  const iconR = 9;
  const iconCx = rx + 14;
  const iconCy = ry + h / 2;
  const icon = TYPE_ICONS[node.oirType] ?? '?';
  drawIconCircle(ctx, iconCx, iconCy, iconR, color, icon, 9);

  // Node name
  ctx.font = '11px "Geist",system-ui,sans-serif';
  ctx.fillStyle = theme.nodeText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textX = iconCx + iconR + 6;
  const maxChars = Math.floor((w - (textX - rx) - 12) / 6.5);
  ctx.fillText(truncate(node.label, maxChars), textX, iconCy);

  // Error count chip
  if (node.errorCount && node.errorCount > 0) {
    const chipCx = rx + w - 9;
    const chipCy = ry + 7;
    ctx.beginPath();
    ctx.arc(chipCx, chipCy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = 'rgba(239,68,68,0.5)';
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 7px system-ui';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.min(node.errorCount, 99)), chipCx, chipCy);
  }

  ctx.globalAlpha = 1;
}

// ─── CARD ─────────────────────────────────────────────────────────────────

function drawCard(
  ctx: CanvasRenderingContext2D,
  node: D3SimNode,
  x: number, y: number,
  w: number, h: number,
  color: string,
  theme: CanvasTheme,
  isSelected: boolean,
  isDimmed: boolean,
  isHeatmap: boolean,
  heatLevel: string,
  isEntryPoint: boolean,
  clusterColor: string | null,
  now: number,
): void {
  const rx = x - w / 2;
  const ry = y - h / 2;

  ctx.globalAlpha = isDimmed ? 0.05 : 1;

  // ── Shadow / glow ─────────────────────────────────────────────────────
  if (isSelected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
  }

  // ── Main background with gradient ─────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(rx, ry, rx, ry + h);
  bgGrad.addColorStop(0,   hexToRgba(color, 0.10));
  bgGrad.addColorStop(0.4, hexToRgba(color, 0.04));
  bgGrad.addColorStop(1,   theme.nodeBg);
  roundedRect(ctx, rx, ry, w, h, 9);
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Heatmap tint
  if (isHeatmap && heatLevel !== 'none') {
    roundedRect(ctx, rx, ry, w, h, 9);
    ctx.fillStyle = heatColor(heatLevel);
    ctx.fill();
    if (heatLevel === 'critical') {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      ctx.shadowColor = 'rgba(220,38,38,0.7)';
      ctx.shadowBlur = 10 + pulse * 10;
      roundedRect(ctx, rx, ry, w, h, 9);
      ctx.strokeStyle = `rgba(220,38,38,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // ── Border ────────────────────────────────────────────────────────────
  roundedRect(ctx, rx, ry, w, h, 9);
  ctx.strokeStyle = isSelected ? color : hexToRgba(color, 0.28);
  ctx.lineWidth = isSelected ? 1.5 : 0.75;
  ctx.stroke();

  // ── Top accent bar (3px gradient line below top border) ───────────────
  const barGrad = ctx.createLinearGradient(rx + 12, 0, rx + w - 12, 0);
  barGrad.addColorStop(0, 'rgba(0,0,0,0)');
  barGrad.addColorStop(0.2, color);
  barGrad.addColorStop(0.8, color);
  barGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(rx + 16, ry + 1.5);
  ctx.lineTo(rx + w - 16, ry + 1.5);
  ctx.strokeStyle = barGrad;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  // ── Header: icon circle + name ────────────────────────────────────────
  const headerY = ry + 16;
  const iconR = 11;
  const iconCx = rx + 16 + iconR;
  const icon = TYPE_ICONS[node.oirType] ?? '?';
  drawIconCircle(ctx, iconCx, headerY, iconR, color, icon, 11);

  const nameX = iconCx + iconR + 8;
  const maxNameW = w - (nameX - rx) - 10;
  const maxNameChars = Math.floor(maxNameW / 7.5);
  ctx.font = 'bold 12px "Geist",system-ui,sans-serif';
  ctx.fillStyle = theme.nodeText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(node.label, maxNameChars), nameX, headerY);

  // ── Divider ───────────────────────────────────────────────────────────
  if (h >= 54) {
    ctx.beginPath();
    ctx.moveTo(rx + 12, ry + 32);
    ctx.lineTo(rx + w - 12, ry + 32);
    ctx.strokeStyle = hexToRgba(color, 0.12);
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // ── Body ──────────────────────────────────────────────────────────────
  if (h >= 54) {
    const bodyY = ry + 43;
    const fp = node.filePath ?? '';
    const shortPath = fp.includes('/')
      ? '…/' + fp.split('/').slice(-2).join('/')
      : fp;
    const maxPathChars = Math.floor((w - 28) / 6.2);
    ctx.font = '10px "Geist Mono","JetBrains Mono",monospace';
    ctx.fillStyle = hexToRgba(theme.nodeSubtext, 0.85);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(shortPath, maxPathChars), rx + 14, bodyY);

    if (h >= 68 && node.docComment) {
      ctx.font = 'italic 9.5px "Geist",system-ui,sans-serif';
      ctx.fillStyle = hexToRgba(theme.nodeSubtext, 0.55);
      const maxDocChars = Math.floor((w - 28) / 5.8);
      ctx.fillText(truncate(node.docComment, maxDocChars), rx + 14, bodyY + 15);
    }
  }

  // ── Footer chips ──────────────────────────────────────────────────────
  if (h >= 42) {
    const footerY = ry + h - 11;

    // Error count chip
    if (node.errorCount && node.errorCount > 0) {
      const chipCx = rx + w - 11;
      ctx.beginPath();
      ctx.arc(chipCx, footerY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#dc2626';
      ctx.shadowColor = 'rgba(220,38,38,0.6)';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = 'bold 7.5px system-ui';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.min(node.errorCount, 99)), chipCx, footerY);
    }

    // Entry point arrow
    if (isEntryPoint) {
      const epX = rx + w - (node.errorCount ? 28 : 11);
      ctx.beginPath();
      ctx.moveTo(epX - 5, footerY - 4);
      ctx.lineTo(epX + 4, footerY);
      ctx.lineTo(epX - 5, footerY + 4);
      ctx.closePath();
      ctx.fillStyle = '#facc15';
      ctx.fill();
    }

    // Cluster dot
    if (clusterColor) {
      ctx.beginPath();
      ctx.arc(rx + 12, footerY, 4, 0, Math.PI * 2);
      ctx.fillStyle = clusterColor;
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
}

// ─── Public: draw a single node ────────────────────────────────────────────

export function drawNode(
  ctx: CanvasRenderingContext2D,
  node: D3SimNode,
  lod: LODLevel,
  theme: CanvasTheme,
  visualState: GraphVisualState,
  now: number,
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;

  const color = TYPE_COLORS[node.oirType] ?? '#94a3b8';
  const isSelected = visualState.selectedNodeIds.has(node.id);
  const hasFocus = visualState.focusedNodeId !== null;
  const isDimmed = hasFocus &&
    !visualState.connectedNodeIds.has(node.id) &&
    node.id !== visualState.focusedNodeId;

  // Filter by node type
  if (visualState.nodeTypeFilters.size > 0 && visualState.nodeTypeFilters.has(node.oirType)) {
    return;
  }

  // Heatmap
  const heatEntry = visualState.heatmapData.get(node.id);
  const isHeatmap = visualState.heatmapActive;
  const heatLevel = heatEntry?.heatLevel ?? 'none';

  // Cluster
  const clusterInfo = visualState.clusterMap.get(node.id);
  const clusterColor = clusterInfo?.color ?? null;

  // Entry point
  const isEntryPoint = node.isEntryPoint ?? false;

  if (lod === 'dot') {
    drawDot(ctx, node, x, y, color, isSelected, isDimmed);
  } else if (lod === 'pill') {
    drawPill(
      ctx, node, x, y, node.width, node.height, color, theme,
      isSelected, isDimmed, isHeatmap, heatLevel,
    );
  } else {
    drawCard(
      ctx, node, x, y, node.width, node.height, color, theme,
      isSelected, isDimmed, isHeatmap, heatLevel, isEntryPoint, clusterColor, now,
    );
  }

  // Search match ring — drawn after main node render
  if (visualState.searchResultIds.size > 0 && visualState.searchResultIds.has(node.id)) {
    const pad = lod === 'dot' ? 4 : 6;
    const rx = lod === 'dot' ? 8 + pad : node.width / 2 + pad;
    const ry = lod === 'dot' ? 8 + pad : node.height / 2 + pad;
    ctx.save();
    ctx.strokeStyle = '#f59e0b'; // amber-400
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (lod === 'dot') {
      ctx.arc(x, y, rx, 0, Math.PI * 2);
    } else {
      const rr = 10;
      ctx.moveTo(x - rx + rr, y - ry);
      ctx.lineTo(x + rx - rr, y - ry);
      ctx.arcTo(x + rx, y - ry, x + rx, y - ry + rr, rr);
      ctx.lineTo(x + rx, y + ry - rr);
      ctx.arcTo(x + rx, y + ry, x + rx - rr, y + ry, rr);
      ctx.lineTo(x - rx + rr, y + ry);
      ctx.arcTo(x - rx, y + ry, x - rx, y + ry - rr, rr);
      ctx.lineTo(x - rx, y - ry + rr);
      ctx.arcTo(x - rx, y - ry, x - rx + rr, y - ry, rr);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ─── Flow animation node highlight ────────────────────────────────────────

export function drawNodeFlowOverlay(
  ctx: CanvasRenderingContext2D,
  node: D3SimNode,
  state: 'active' | 'completed' | 'error',
  lod: LODLevel,
): void {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = lod === 'dot' ? 8 : node.width / 2 + 4;

  const colors = {
    active:    { fill: 'rgba(251,191,36,0.25)', stroke: '#fbbf24' },
    completed: { fill: 'rgba(34,197,94,0.2)',   stroke: '#22c55e' },
    error:     { fill: 'rgba(239,68,68,0.25)',  stroke: '#ef4444' },
  };
  const c = colors[state];

  if (lod === 'dot') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    const w = node.width;
    const h = node.height;
    roundedRect(ctx, x - w / 2, y - h / 2, w, h, 8);
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
