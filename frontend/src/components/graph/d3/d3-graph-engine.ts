/**
 * D3GraphEngine — core Canvas 2D rendering engine for Omnious code graphs.
 *
 * Responsibilities:
 *  - Manages a D3 force simulation (layout)
 *  - Drives a requestAnimationFrame render loop (stops when simulation settles)
 *  - Handles all canvas interactions: zoom/pan, click, hover, drag, context menu
 *  - Provides `setGraph` (data), `updateVisualState` (visual flags), `fitGraph` / `focusNode`
 *  - Exposes clean public API consumed by the React wrapper (D3GraphCanvas)
 *
 * Performance targets:
 *  - 10k nodes + edges at 60fps during zoom/pan after simulation settles
 *  - Viewport culling: only draw nodes/edges in the visible canvas area
 *  - Quadtree O(log n) hit-testing on every pointer move
 *  - LOD tier switching: dot → pill → card (based on zoom scale)
 */

import * as d3 from 'd3';
import type { OmniousNode, OmniousEdge, OmniousNodeData } from '@/lib/stores/graph-store';
import { NODE_SIZE_DIMENSIONS } from '@/lib/stores/graph-store';
import {
  type D3SimNode,
  type D3SimLink,
  type GraphVisualState,
  type EngineCallbacks,
  type LODLevel,
  getLOD,
  DARK_THEME,
} from './types';
import { createSimulation, preSettleSimulation, type LayoutMode } from './d3-layout';
import { drawNode, drawNodeFlowOverlay } from './d3-node-renderer';
import { drawEdge, drawFlowDot } from './d3-edge-renderer';
import {
  createZoomBehavior,
  buildQuadtree,
  hitTestNode,
  hitTestEdge,
  canvasToWorld,
  viewportBounds,
} from './d3-interactions';

// ─── Engine ────────────────────────────────────────────────────────────────

export class D3GraphEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  private simNodes: D3SimNode[] = [];
  private simLinks: D3SimLink[] = [];
  private rawEdges: OmniousEdge[] = [];

  private simulation: d3.Simulation<D3SimNode, D3SimLink> | null = null;
  private zoom: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private transform: d3.ZoomTransform = d3.zoomIdentity;

  private quadtree: d3.Quadtree<D3SimNode> = d3.quadtree<D3SimNode>();

  private rafId = 0;
  private dirty = false;
  private destroyed = false;

  private visualState: GraphVisualState = {
    selectedNodeIds: new Set(),
    focusedNodeId: null,
    connectedNodeIds: new Set(),
    heatmapActive: false,
    heatmapData: new Map(),
    pinnedNodeIds: new Set(),
    errorFlowNodeIds: new Set(),
    errorFlowEdgeIds: new Set(),
    activeNodeId: null,
    activeEdgeIds: new Set(),
    completedNodeIds: new Set(),
    errorNodeIds: new Set(),
    nodeTypeFilters: new Set(),
    severityFilters: new Set(),
    hoveredEdgeId: null,
    clusterMap: new Map(),
    layoutMode: 'layered-tb',
  };

  private layoutMode: LayoutMode = 'layered-tb';

  // Interaction state
  private hoveredNodeId: string | null = null;

  // Flow animation
  private flowDotT = 0;
  private lastFlowTime = 0;

  private callbacks: EngineCallbacks;
  private abortController = new AbortController();

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get 2D canvas context');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;

    // Apply DPR for sharp rendering on retina displays
    this.applyDPR();

    // Zoom behavior
    this.zoom = createZoomBehavior(canvas, (t) => {
      this.transform = t;
      this.markDirty();
    });

    // Input event listeners
    this.mountEvents();
  }

  // ─── DPR / sizing ─────────────────────────────────────────────────────────

  private applyDPR(): void {
    const { canvas, ctx, dpr } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
  }

  resize(cssWidth: number, cssHeight: number): void {
    const { canvas, ctx, dpr } = this;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);
    this.markDirty();
  }

  // ─── Data ──────────────────────────────────────────────────────────────────

  setGraph(nodes: OmniousNode[], edges: OmniousEdge[]): void {
    // Stop old simulation
    this.simulation?.stop();
    cancelAnimationFrame(this.rafId);

    this.rawEdges = edges;

    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;

    // Build sim nodes
    const prevPositions = new Map(this.simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));

    this.simNodes = nodes.map((n): D3SimNode => {
      const dims = NODE_SIZE_DIMENSIONS[n.data.sizeTier ?? 'medium'];
      const prev = prevPositions.get(n.id);
      const spread = 200;
      return {
        ...n.data,
        id: n.id,
        width: dims.width,
        height: dims.height,
        x: prev?.x ?? (Math.random() - 0.5) * spread + cssW / 2,
        y: prev?.y ?? (Math.random() - 0.5) * spread + cssH / 2,
        // Restore persisted position as fixed if it was previously pinned
        fx: null,
        fy: null,
      };
    });

    // Pin nodes that are in pinnedNodeIds
    for (const node of this.simNodes) {
      if (this.visualState.pinnedNodeIds.has(node.id)) {
        node.fx = node.x;
        node.fy = node.y;
      }
    }

    // Build sim links (resolved by ID)
    const nodeById = new Map(this.simNodes.map((n) => [n.id, n]));
    this.simLinks = edges
      .map((e): D3SimLink | null => {
        const src = nodeById.get(e.source);
        const tgt = nodeById.get(e.target);
        if (!src || !tgt) return null;
        return { id: e.id, data: e.data, source: src, target: tgt };
      })
      .filter((l): l is D3SimLink => l !== null);

    // Create simulation
    this.simulation = createSimulation(
      this.simNodes,
      this.simLinks,
      edges,
      this.layoutMode,
      cssW,
      cssH,
    );

    // Rebuild quadtree
    this.quadtree = buildQuadtree(this.simNodes);

    // Each simulation tick: rebuild quadtree + schedule render
    this.simulation.on('tick', () => {
      this.quadtree = buildQuadtree(this.simNodes);
      this.markDirty();
    });

    this.simulation.on('end', () => {
      this.markDirty(); // Final render
    });

    // Pre-settle in background, then freeze all nodes in-place
    preSettleSimulation(
      this.simulation,
      () => {
        this.freezeAllNodes();
        this.quadtree = buildQuadtree(this.simNodes);
        this.fitGraph();
        this.startRenderLoop();
      },
      25,
      nodes.length > 500 ? 200 : 300,
    );
  }

  updateVisualState(state: GraphVisualState): void {
    this.visualState = state;
    this.layoutMode = state.layoutMode;
    this.markDirty();
  }

  /** Pin every node at its current position — makes the graph static. */
  private freezeAllNodes(): void {
    for (const node of this.simNodes) {
      node.fx = node.x;
      node.fy = node.y;
    }
    this.simulation?.stop();
  }

  setLayoutMode(mode: LayoutMode): void {
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    // Re-run simulation with new layout biases
    if (this.simNodes.length > 0) {
      this.setGraph(
        this.simNodes.map((n) => ({
          id: n.id,
          data: n as unknown as OmniousNodeData,
          position: { x: n.x ?? 0, y: n.y ?? 0 },
        })),
        this.rawEdges,
      );
    }
  }

  // ─── Camera controls ───────────────────────────────────────────────────────

  fitGraph(): void {
    if (this.simNodes.length === 0) return;

    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const PADDING = 60;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.simNodes) {
      if (!n.x || !n.y) continue;
      minX = Math.min(minX, n.x - n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }

    if (!isFinite(minX)) return;

    const graphW = maxX - minX + PADDING * 2;
    const graphH = maxY - minY + PADDING * 2;
    const scale = Math.min(cssW / graphW, cssH / graphH, 2);
    const tx = (cssW - graphW * scale) / 2 - minX * scale + PADDING * scale;
    const ty = (cssH - graphH * scale) / 2 - minY * scale + PADDING * scale;

    d3.select(this.canvas)
      .transition()
      .duration(400)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  focusNode(id: string): void {
    const node = this.simNodes.find((n) => n.id === id);
    if (!node || !node.x || !node.y) return;

    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    // Preserve the current zoom level — only pan so the node is centred
    const scale = this.transform.k;
    const tx = cssW / 2 - node.x * scale;
    const ty = cssH / 2 - node.y * scale;

    d3.select(this.canvas)
      .transition()
      .duration(350)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // ─── Render loop ───────────────────────────────────────────────────────────

  private startRenderLoop(): void {
    const loop = () => {
      if (this.destroyed) return;
      if (this.dirty) {
        this.render();
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private render(): void {
    const { ctx, transform, simNodes, simLinks, visualState } = this;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    const now = performance.now();
    const hasFocus = visualState.focusedNodeId !== null;

    // Clear
    ctx.fillStyle = DARK_THEME.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // Background dot grid
    this.drawGrid(cssW, cssH);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const lod: LODLevel = getLOD(transform.k);
    const vp = viewportBounds(transform, cssW, cssH);
    const MARGIN = 80;

    // ── Viewport cull helper ─────────────────────────────────────────────
    const edgeVisible = (link: D3SimLink) => {
      const src = link.source; const tgt = link.target;
      if (src.x === undefined || src.y === undefined) return false;
      const sv = src.x >= vp.minX - MARGIN && src.x <= vp.maxX + MARGIN &&
                 src.y >= vp.minY - MARGIN && src.y <= vp.maxY + MARGIN;
      const tv = tgt.x !== undefined && tgt.y !== undefined &&
                 tgt.x >= vp.minX - MARGIN && tgt.x <= vp.maxX + MARGIN &&
                 tgt.y >= vp.minY - MARGIN && tgt.y <= vp.maxY + MARGIN;
      return sv || tv;
    };
    const nodeVisible = (node: D3SimNode) => {
      if (node.x === undefined || node.y === undefined) return false;
      return !(node.x + node.width / 2  < vp.minX - MARGIN ||
               node.x - node.width / 2  > vp.maxX + MARGIN ||
               node.y + node.height / 2 < vp.minY - MARGIN ||
               node.y - node.height / 2 > vp.maxY + MARGIN);
    };

    // ── Draw edges (behind nodes) ────────────────────────────────────────
    for (const link of simLinks) {
      if (!edgeVisible(link)) continue;
      const src = link.source; const tgt = link.target;
      if (visualState.nodeTypeFilters.size > 0 &&
          (visualState.nodeTypeFilters.has(src.oirType) ||
           visualState.nodeTypeFilters.has(tgt.oirType))) continue;
      drawEdge(ctx, link, visualState, lod);
    }

    // ── Flow dots on active edges ────────────────────────────────────────
    if (visualState.activeEdgeIds.size > 0) {
      const elapsed = now - this.lastFlowTime;
      this.lastFlowTime = now;
      this.flowDotT = (this.flowDotT + elapsed / 1200) % 1;
      this.markDirty();
      for (const link of simLinks) {
        if (visualState.activeEdgeIds.has(link.id)) drawFlowDot(ctx, link, this.flowDotT);
      }
    }

    // ── Draw nodes (normal mode) ─────────────────────────────────────────
    if (!hasFocus) {
      const selectedLater: D3SimNode[] = [];
      for (const node of simNodes) {
        if (!nodeVisible(node)) continue;
        if (visualState.selectedNodeIds.has(node.id)) { selectedLater.push(node); continue; }
        drawNode(ctx, node, lod, DARK_THEME, visualState, now);
      }
      // Flow overlays
      for (const node of simNodes) {
        if (node.x === undefined || visualState.activeNodeId === null) continue;
        let flowState: 'active' | 'completed' | 'error' | null = null;
        if (visualState.activeNodeId === node.id) flowState = 'active';
        else if (visualState.errorNodeIds.has(node.id)) flowState = 'error';
        else if (visualState.completedNodeIds.has(node.id)) flowState = 'completed';
        if (flowState) drawNodeFlowOverlay(ctx, node, flowState, lod);
      }
      for (const node of selectedLater) drawNode(ctx, node, lod, DARK_THEME, visualState, now);
    }

    ctx.restore();

    // ── Focus mode: spotlight overlay + re-draw connected cluster ────────
    if (hasFocus) {
      // Dark fog over the entire canvas
      ctx.fillStyle = 'rgba(7,8,14,0.86)';
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const focusId = visualState.focusedNodeId!;
      const isConnected = (id: string) =>
        id === focusId || visualState.connectedNodeIds.has(id);

      // Connected edges — only draw when BOTH endpoints are in the focus cluster
      for (const link of simLinks) {
        if (!edgeVisible(link)) continue;
        if (!isConnected(link.source.id) || !isConnected(link.target.id)) continue;
        drawEdge(ctx, link, visualState, lod);
      }

      // Connected nodes (selected always on top)
      const focusSelectedLater: D3SimNode[] = [];
      for (const node of simNodes) {
        if (!isConnected(node.id)) continue;
        if (!nodeVisible(node)) continue;
        if (visualState.selectedNodeIds.has(node.id)) {
          focusSelectedLater.push(node); continue;
        }
        drawNode(ctx, node, lod, DARK_THEME, visualState, now);
      }
      for (const node of focusSelectedLater) {
        drawNode(ctx, node, lod, DARK_THEME, visualState, now);
      }

      ctx.restore();
    }
  }

  private drawGrid(w: number, h: number): void {
    const { ctx, transform } = this;
    const k = transform.k;
    if (k < 0.15) return; // Too zoomed out — skip grid

    const spacing = 40;
    const gridSpacing = spacing * k;
    if (gridSpacing < 8) return;

    const offsetX = transform.x % gridSpacing;
    const offsetY = transform.y % gridSpacing;

    ctx.fillStyle = DARK_THEME.gridDot;
    const r = Math.max(0.5, k * 0.5);

    for (let x = offsetX; x < w; x += gridSpacing) {
      for (let y = offsetY; y < h; y += gridSpacing) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── Event handling ─────────────────────────────────────────────────────────

  private mountEvents(): void {
    const { canvas } = this;
    const sig = this.abortController.signal;

    canvas.addEventListener('click', this.handleClick, { signal: sig } as AddEventListenerOptions);
    canvas.addEventListener('pointermove', this.handlePointerMove, { signal: sig } as AddEventListenerOptions);
    canvas.addEventListener('pointerdown', this.handlePointerDown, { signal: sig } as AddEventListenerOptions);
    canvas.addEventListener('pointerup', this.handlePointerUp, { signal: sig } as AddEventListenerOptions);
    canvas.addEventListener('contextmenu', this.handleContextMenu, { signal: sig } as AddEventListenerOptions);
    canvas.addEventListener('dblclick', this.handleDblClick, { signal: sig } as AddEventListenerOptions);

    window.addEventListener('keydown', this.handleKeyDown, { signal: sig } as AddEventListenerOptions);
    window.addEventListener('omnious:focus-fit', () => this.fitGraph(), { signal: sig } as AddEventListenerOptions);
    window.addEventListener('omnious:focus-node', (e: Event) => {
      const { nodeId } = (e as CustomEvent<{ nodeId: string }>).detail;
      this.focusNode(nodeId);
    }, { signal: sig } as AddEventListenerOptions);
    window.addEventListener('omnious:pan', (e: Event) => {
      const { dx, dy } = (e as CustomEvent<{ dx: number; dy: number }>).detail;
      const t = this.transform;
      d3.select(this.canvas).call(
        this.zoom.transform,
        d3.zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k),
      );
    }, { signal: sig } as AddEventListenerOptions);
    window.addEventListener('omnious:zoom-in', () => {
      d3.select(this.canvas).call(this.zoom.scaleBy, 1.2);
    }, { signal: sig } as AddEventListenerOptions);
    window.addEventListener('omnious:zoom-out', () => {
      d3.select(this.canvas).call(this.zoom.scaleBy, 1 / 1.2);
    }, { signal: sig } as AddEventListenerOptions);

    document.addEventListener('visibilitychange', this.handleVisibilityChange, { signal: sig } as AddEventListenerOptions);
  }

  private getWorldPointer(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return canvasToWorld(this.transform, e.clientX - rect.left, e.clientY - rect.top);
  }

  private handleClick = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const world = this.getWorldPointer(e);
    const node = hitTestNode(this.quadtree, world.x, world.y);
    if (node) {
      this.callbacks.onNodeClick(node.id);
    } else {
      this.callbacks.onNodeClick('');
    }
  };

  private handleDblClick = (e: MouseEvent): void => {
    const world = this.getWorldPointer(e);
    const node = hitTestNode(this.quadtree, world.x, world.y);
    if (node) {
      this.focusNode(node.id);
    } else {
      this.fitGraph();
    }
  };

  private handlePointerMove = (e: PointerEvent): void => {
    const world = this.getWorldPointer(e);
    const node = hitTestNode(this.quadtree, world.x, world.y);
    const newHoverId = node?.id ?? null;

    if (newHoverId !== this.hoveredNodeId) {
      this.hoveredNodeId = newHoverId;
      this.canvas.style.cursor = newHoverId ? 'pointer' : 'default';
      this.markDirty();
    }

    // Edge hover hit test (only when no node is hovered)
    if (!node) {
      const edge = hitTestEdge(this.simLinks, world.x, world.y);
      const newEdgeId = edge?.id ?? null;
      if (newEdgeId !== this.visualState.hoveredEdgeId) {
        this.callbacks.onEdgeHover(newEdgeId);
      }
    }
  };

  private handlePointerDown = (_e: PointerEvent): void => {
    // Nodes are static — no drag, pointer events just let d3-zoom handle panning.
  };

  private handlePointerUp = (_e: PointerEvent): void => {
    // Nodes are static — no drag cleanup needed.
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const world = this.getWorldPointer(e);
    const node = hitTestNode(this.quadtree, world.x, world.y);

    if (node) {
      this.callbacks.onNodeContextMenu(node.id, node.label, e.clientX, e.clientY);
    } else {
      this.callbacks.onPaneContextMenu(e.clientX, e.clientY);
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Only fire if not in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement)?.isContentEditable
    ) return;

    switch (e.key) {
      case 'h':
      case 'H':
        this.fitGraph();
        break;
      case 'Escape':
        this.callbacks.onNodeClick(''); // Deselect / clear focus
        break;
    }
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
    } else {
      this.markDirty();
      this.startRenderLoop();
    }
  };

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.simulation?.stop();
    this.abortController.abort();
    d3.select(this.canvas).on('.zoom', null);
  }
}
