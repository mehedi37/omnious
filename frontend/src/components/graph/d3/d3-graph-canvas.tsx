'use client';

/**
 * D3GraphCanvas — React wrapper for D3GraphEngine.
 *
 * Mounts the D3 engine on a <canvas> element, subscribes to the Zustand
 * graph store for data and visual state, and bridges engine callbacks back
 * to store actions. This component has NO React-rendered graph elements —
 * all rendering is done imperatively via Canvas 2D.
 *
 * Usage:
 *   <D3GraphCanvas className="h-full w-full" onNodeClick={...} />
 */

import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';
import { D3GraphEngine } from './d3-graph-engine';
import type { GraphVisualState } from './types';
import { useGraphContextMenu } from '../graph-context-menu';
import type { OIRNodeType } from '@/lib/oir/types';

export interface D3GraphCanvasProps {
  className?: string;
  onNodeClick?: (nodeId: string) => void;
}

export function D3GraphCanvas({ className, onNodeClick }: D3GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<D3GraphEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Context menu hook
  const { onNodeContextMenu, onPaneContextMenu, setContainerRef, menuElement } =
    useGraphContextMenu();

  // Set container ref for context menu scroll tracking
  useEffect(() => {
    setContainerRef(containerRef.current);
  }, [setContainerRef]);

  // ── Engine initialization ──────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new D3GraphEngine(canvas, {
      onNodeClick: (nodeId) => {
        if (!nodeId) {
          useGraphStore.getState().deselectAll();
          useGraphStore.getState().clearFocusMode();
        } else {
          useGraphStore.getState().selectNode(nodeId);
          useGraphStore.getState().highlightConnectedEdges(nodeId);
          useUIStore.getState().setDetailPanelOpen(true);
          useUIStore.getState().setActiveDetailTab('details');
          onNodeClick?.(nodeId);
        }
      },
      onNodeContextMenu: (nodeId, nodeName, x, y) => {
        // Bridge to the existing context menu hook using a synthetic event
        const syntheticEvent = {
          preventDefault: () => {},
          stopPropagation: () => {},
          clientX: x,
          clientY: y,
        } as unknown as React.MouseEvent;
        onNodeContextMenu(syntheticEvent, { id: nodeId, data: { label: nodeName } });
      },
      onPaneContextMenu: (x, y) => {
        const syntheticEvent = {
          preventDefault: () => {},
          clientX: x,
          clientY: y,
        } as unknown as React.MouseEvent;
        onPaneContextMenu(syntheticEvent);
      },
      onEdgeHover: (edgeId) => {
        useGraphStore.getState().setHoveredEdgeId(edgeId);
      },
      onTransformChange: (tx, ty, k) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.dispatchEvent(new CustomEvent('omnious:transform', {
          detail: { tx, ty, k, w: canvas.clientWidth, h: canvas.clientHeight },
          bubbles: true,
        }));
      },
    });

    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [onNodeClick, onNodeContextMenu, onPaneContextMenu]);

  // ── Resize observer ────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        engineRef.current?.resize(width, height);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Graph data subscription ────────────────────────────────────────────────

  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => ({ nodes: s.nodes, edges: s.edges }),
      ({ nodes, edges }) => {
        engineRef.current?.setGraph(nodes, edges);
      },
      {
        equalityFn: (a, b) => a.nodes === b.nodes && a.edges === b.edges,
        fireImmediately: true,
      },
    );
  }, []);

  // ── Visual state subscription ──────────────────────────────────────────────

  const buildVisualState = useCallback((s: ReturnType<typeof useGraphStore.getState>): GraphVisualState => ({
    selectedNodeIds: s.selectedNodeIds,
    focusedNodeId: s.focusedNodeId,
    connectedNodeIds: s.connectedNodeIds,
    heatmapActive: s.heatmapActive,
    heatmapData: s.heatmapData,
    pinnedNodeIds: s.pinnedNodeIds,
    errorFlowNodeIds: s.errorFlowNodeIds,
    errorFlowEdgeIds: s.errorFlowEdgeIds,
    activeNodeId: s.activeNodeId,
    activeEdgeIds: s.activeEdgeIds,
    completedNodeIds: s.completedNodeIds,
    errorNodeIds: s.errorNodeIds,
    nodeTypeFilters: s.nodeTypeFilters as Set<OIRNodeType>,
    severityFilters: s.severityFilters as Set<string>,
    hoveredEdgeId: s.hoveredEdgeId,
    clusterMap: s.clusterMap,
    layoutMode: s.layoutMode,
    searchResultIds: s.searchResultIds,
  }), []);

  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => buildVisualState(s),
      (visualState) => {
        engineRef.current?.updateVisualState(visualState);
      },
      {
        equalityFn: (a, b) =>
          a.selectedNodeIds === b.selectedNodeIds &&
          a.focusedNodeId === b.focusedNodeId &&
          a.connectedNodeIds === b.connectedNodeIds &&
          a.heatmapActive === b.heatmapActive &&
          a.heatmapData === b.heatmapData &&
          a.pinnedNodeIds === b.pinnedNodeIds &&
          a.errorFlowNodeIds === b.errorFlowNodeIds &&
          a.errorFlowEdgeIds === b.errorFlowEdgeIds &&
          a.activeNodeId === b.activeNodeId &&
          a.activeEdgeIds === b.activeEdgeIds &&
          a.completedNodeIds === b.completedNodeIds &&
          a.errorNodeIds === b.errorNodeIds &&
          a.nodeTypeFilters === b.nodeTypeFilters &&
          a.hoveredEdgeId === b.hoveredEdgeId &&
          a.clusterMap === b.clusterMap &&
          a.layoutMode === b.layoutMode &&
          a.searchResultIds === b.searchResultIds,
        fireImmediately: true,
      },
    );
  }, [buildVisualState]);

  // ── Layout mode subscription ───────────────────────────────────────────────

  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.layoutMode,
      (mode) => engineRef.current?.setLayoutMode(mode),
    );
  }, []);

  // ── Focus node subscription — pan + zoom to node when focusedNodeId changes ─

  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.focusedNodeId,
      (nodeId) => {
        if (nodeId) engineRef.current?.focusNode(nodeId);
      },
    );
  }, []);

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        aria-label="Code graph visualization"
      />
      {menuElement}
    </div>
  );
}
