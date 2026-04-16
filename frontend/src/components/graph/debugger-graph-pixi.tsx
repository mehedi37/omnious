'use client';
/**
 * debugger-graph-pixi.tsx
 *
 * WebGL graph canvas — raw PixiJS v8 imperative API, NO @pixi/react.
 * Avoids @pixi/react to prevent its React reconciler from interfering
 * with Next.js/Turbopack SSR module initialization order.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { OmniousNode, OmniousEdge } from '@/lib/stores/graph-store';
import type { OIRNodeType } from '@/lib/oir/types';

export interface DebuggerGraphProps {
  nodes: OmniousNode[];
  edges: OmniousEdge[];
  width?: number;
  height?: number;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

const NODE_COLORS: Partial<Record<OIRNodeType, number>> = {
  function: 0x22c55e, component: 0x3b82f6, route: 0xf97316,
  database_query: 0xa855f7, module: 0x94a3b8, class: 0x6366f1,
  middleware: 0xf59e0b, event_emitter: 0x06b6d4, event_listener: 0x14b8a6,
  external_api: 0xec4899, variable: 0x9ca3af, type_def: 0x8b5cf6,
};
const EDGE_COLORS: Record<string, number> = {
  calls: 0x3b82f6, imports: 0x94a3b8, uses: 0x6366f1,
  returns: 0x22c55e, inherits: 0xf97316, implements: 0xa855f7,
  runtime_call: 0xf59e0b,
};
const NODE_BG = 0x0f1117, NODE_BORDER = 0x1e2130, TEXT_TITLE = 0xf1f5f9;
const TEXT_SUB = 0x94a3b8, DOT_FALLBACK = 0x334155, EDGE_DEFAULT = 0x334155;
const LOD_MINIMAL = 0.35, LOD_COMPACT = 0.65, NODE_W = 220, TITLE_H = 32;

function accent(type: string): number {
  return NODE_COLORS[type as OIRNodeType] ?? DOT_FALLBACK;
}

function getLOD(z: number): 'minimal' | 'compact' | 'full' {
  return z < LOD_MINIMAL ? 'minimal' : z < LOD_COMPACT ? 'compact' : 'full';
}

function renderNode(
  cont: Container,
  label: string,
  subtitle: string | undefined,
  type: string,
  selected: boolean,
  lod: 'minimal' | 'compact' | 'full',
): void {
  while (cont.children.length) cont.removeChildAt(0);
  const acc = accent(type);

  if (lod === 'minimal') {
    const g = new Graphics();
    g.circle(6, 6, 6).fill({ color: acc });
    cont.addChild(g);
    return;
  }

  const bodyH = lod === 'compact' ? 0 : subtitle ? 32 : 24;
  const totalH = TITLE_H + bodyH + 2;

  const bg = new Graphics();
  bg.roundRect(2, 2, NODE_W - 4, totalH - 4, 6)
    .fill({ color: NODE_BG })
    .stroke({ color: selected ? 0x4f6ef7 : NODE_BORDER, width: selected ? 1.5 : 1 });
  bg.rect(2, 2, 3, totalH - 4).fill({ color: acc, alpha: 0.8 });
  cont.addChild(bg);

  const bar = new Graphics();
  bar.roundRect(2, 2, NODE_W - 4, TITLE_H - 2, 6).fill({ color: acc, alpha: 0.12 });
  cont.addChild(bar);

  const title = new Text({
    text: label,
    style: { fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: '600', fill: TEXT_TITLE },
  });
  title.position.set(14, (TITLE_H - 14) / 2);
  cont.addChild(title);

  if (lod === 'full' && subtitle) {
    const sub = new Text({
      text: subtitle,
      style: { fontFamily: 'ui-monospace, monospace', fontSize: 10, fill: TEXT_SUB },
    });
    sub.position.set(14, TITLE_H + 4);
    cont.addChild(sub);
  }
}

function redrawEdges(gfx: Graphics, nodes: OmniousNode[], edges: OmniousEdge[]): void {
  gfx.clear();
  const map = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = map.get(e.source), tgt = map.get(e.target);
    if (!src || !tgt) continue;
    const sx = (src.position?.x ?? 0) + 110, sy = (src.position?.y ?? 0) + 16;
    const tx = (tgt.position?.x ?? 0) + 110, ty = (tgt.position?.y ?? 0) + 16;
    const color = EDGE_COLORS[(e.data?.edgeType as string | undefined) ?? ''] ?? EDGE_DEFAULT;
    const cp = Math.abs(ty - sy) * 0.4 + 20;
    gfx.moveTo(sx, sy).bezierCurveTo(sx, sy + cp, tx, ty - cp, tx, ty)
       .stroke({ color, width: 1, alpha: 0.55 });
  }
}

export function DebuggerGraph({ nodes, edges, width, height, onNodeClick, className }: DebuggerGraphProps) {
  const divRef    = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef    = useRef<Application | null>(null);
  const vpRef     = useRef<Viewport | null>(null);
  const gfxRef    = useRef<Graphics | null>(null);
  const contsRef  = useRef<Map<string, Container>>(new Map());
  const [zoom, setZoom] = useState(0.8);
  const [dims, setDims] = useState({ w: width ?? 800, h: height ?? 600 });

  useEffect(() => {
    if (width && height) return;
    const el = divRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const eW = width ?? dims.w;
  const eH = height ?? dims.h;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const app = new Application();
    appRef.current = app;

    const wW = Math.max(eW * 4, ...nodes.map((n) => (n.position?.x ?? 0) + 260));
    const wH = Math.max(eH * 4, ...nodes.map((n) => (n.position?.y ?? 0) + 120));

    void app.init({
      canvas, width: eW, height: eH,
      background: 0x080b14, antialias: true, autoDensity: true,
      resolution: window.devicePixelRatio ?? 1,
    }).then(() => {
      const vp = new Viewport({
        screenWidth: eW, screenHeight: eH, worldWidth: wW, worldHeight: wH,
        events: app.renderer.events,
      });
      vpRef.current = vp;
      app.stage.addChild(vp);
      vp.drag().pinch().wheel().decelerate({ friction: 0.94 });
      vp.clampZoom({ minScale: 0.1, maxScale: 4 });
      vp.setZoom(0.8, true);
      vp.moveCenter(wW / 2, wH / 2);
      vp.on('zoomed', () => setZoom(vp.scale.x));

      const gfx = new Graphics();
      gfxRef.current = gfx;
      vp.addChild(gfx);
      redrawEdges(gfx, nodes, edges);

      const contMap = contsRef.current;
      const lod = getLOD(zoom);
      for (const node of nodes) {
        const cont = new Container();
        cont.position.set(node.position?.x ?? 0, node.position?.y ?? 0);
        cont.eventMode = 'static';
        cont.cursor = 'pointer';
        cont.on('pointerdown', () => onNodeClick?.(node.id));
        renderNode(cont,
          (node.data?.label as string | undefined) ?? node.id,
          (node.data?.filePath as string | null | undefined) ?? undefined,
          (node.data?.oirType as string | undefined) ?? 'module',
          false, lod,
        );
        vp.addChild(cont);
        contMap.set(node.id, cont);
      }
    });

    return () => {
      app.destroy(false);
      appRef.current = null; vpRef.current = null; gfxRef.current = null;
      contsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eW, eH]);

  useEffect(() => {
    const lod = getLOD(zoom);
    for (const node of nodes) {
      const cont = contsRef.current.get(node.id);
      if (!cont) continue;
      renderNode(cont,
        (node.data?.label as string | undefined) ?? node.id,
        (node.data?.filePath as string | null | undefined) ?? undefined,
        (node.data?.oirType as string | undefined) ?? 'module',
        false, lod,
      );
    }
  }, [zoom, nodes]);

  const syncEdges = useCallback(() => {
    if (gfxRef.current) redrawEdges(gfxRef.current, nodes, edges);
  }, [nodes, edges]);

  useEffect(() => { syncEdges(); }, [syncEdges]);

  return (
    <div ref={divRef} className={className}
      style={{ width: width ?? '100%', height: height ?? '100%', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
