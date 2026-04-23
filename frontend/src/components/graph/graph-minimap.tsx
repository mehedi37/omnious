'use client';

/**
 * GraphMinimap — A small overview canvas in the bottom-right of the graph
 * showing all nodes as dots and a viewport indicator.
 *
 * Listens to the `omnious:transform` custom event from D3GraphCanvas for
 * viewport updates and reads node positions from the graph store.
 */

import { useEffect, useRef } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';

const MINIMAP_W = 180;
const MINIMAP_H = 120;
const PADDING = 12;

interface TransformState {
  tx: number;
  ty: number;
  k: number;
  w: number;
  h: number;
}

export function GraphMinimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<TransformState>({ tx: 0, ty: 0, k: 1, w: 800, h: 600 });
  const rafRef = useRef<number | null>(null);

  // We need node positions — these come from simNodes inside the engine but are
  // not in the store. We use the store's `nodes` array for layout after the
  // simulation has set x/y via the `positions` update that the engine fires.
  // For simplicity we read from the engine indirectly: the engine's render
  // already happens; we draw from the store node list with available positions.
  // After simulation ticks, the engine fires `omnious:node-positions` with {id, x, y}[].
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  function scheduleRender() {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      renderMinimap();
    });
  }

  function renderMinimap() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = MINIMAP_W;
    const H = MINIMAP_H;

    // Scale canvas for retina
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = 'rgba(10,11,18,0.90)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, W - 1, H - 1, 8);
    ctx.stroke();

    const positions = positionsRef.current;
    if (positions.size === 0) return;

    // Compute bounds of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of positions.values()) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }

    const graphW = Math.max(maxX - minX, 1);
    const graphH = Math.max(maxY - minY, 1);

    // Map from graph-space to minimap-space
    const availW = W - PADDING * 2;
    const availH = H - PADDING * 2;
    const scaleX = availW / graphW;
    const scaleY = availH / graphH;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = PADDING + (availW - graphW * scale) / 2;
    const offsetY = PADDING + (availH - graphH * scale) / 2;

    function toMapX(x: number) { return offsetX + (x - minX) * scale; }
    function toMapY(y: number) { return offsetY + (y - minY) * scale; }

    // Draw nodes as dots
    const { tx, ty, k } = transformRef.current;

    for (const pos of positions.values()) {
      const mx = toMapX(pos.x);
      const my = toMapY(pos.y);
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(148,163,184,0.7)'; // slate-400
      ctx.fill();
    }

    // Draw viewport rect
    const { w: canvasW, h: canvasH } = transformRef.current;
    // Viewport corners in graph-space
    const vpMinX = (-tx) / k;
    const vpMinY = (-ty) / k;
    const vpMaxX = vpMinX + canvasW / k;
    const vpMaxY = vpMinY + canvasH / k;

    const rx = toMapX(vpMinX);
    const ry = toMapY(vpMinY);
    const rw = (vpMaxX - vpMinX) * scale;
    const rh = (vpMaxY - vpMinY) * scale;

    ctx.strokeStyle = 'rgba(139,92,246,0.8)'; // violet-500
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(139,92,246,0.08)';
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 2);
    ctx.fill();
  }

  // Listen for transform changes
  useEffect(() => {
    function onTransform(e: Event) {
      const { tx, ty, k, w, h } = (e as CustomEvent<TransformState>).detail;
      transformRef.current = { tx, ty, k, w, h };
      scheduleRender();
    }
    window.addEventListener('omnious:transform', onTransform);
    return () => window.removeEventListener('omnious:transform', onTransform);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for node position updates from the engine
  useEffect(() => {
    function onPositions(e: Event) {
      const positions = (e as CustomEvent<{ id: string; x: number; y: number }[]>).detail;
      positionsRef.current = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
      scheduleRender();
    }
    window.addEventListener('omnious:node-positions', onPositions);
    return () => window.removeEventListener('omnious:node-positions', onPositions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also re-render when nodes change in the store (on initial load / graph change)
  const nodeCount = useGraphStore((s) => s.nodes.length);
  useEffect(() => {
    if (nodeCount === 0) {
      positionsRef.current = new Map();
      scheduleRender();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount]);

  return (
    <div
      className="absolute bottom-4 right-4 z-10 rounded-lg overflow-hidden shadow-lg pointer-events-none select-none"
      style={{ width: MINIMAP_W, height: MINIMAP_H }}
    >
      <canvas ref={canvasRef} style={{ width: MINIMAP_W, height: MINIMAP_H }} />
    </div>
  );
}
