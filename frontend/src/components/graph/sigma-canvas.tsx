'use client';

import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { useCallback, useEffect, useRef } from 'react';
import { graphRef, getOrCreateGraph, sigmaRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import type { SigmaEdgeAttributes, SigmaNodeAttributes } from '@/lib/stores/graph-store';
import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';
import type { Settings } from 'sigma/settings';
import { useCanvasNavigation } from '@/hooks/use-canvas-navigation';

// ─── Sigma settings ────────────────────────────────────────────────────────────

const SIGMA_SETTINGS: Partial<Settings<SigmaNodeAttributes, SigmaEdgeAttributes>> = {
  zoomingRatio: 1.5,
  inertiaDuration: 600,
  inertiaRatio: 3,
  zoomDuration: 250,
  minCameraRatio: 0.05,
  maxCameraRatio: 10,
  enableEdgeEvents: true,
  defaultNodeType: 'circle',
  defaultEdgeType: 'arrow',
  labelDensity: 0.07,
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 0.5,
  labelSize: 11,
  labelWeight: '500',
  renderEdgeLabels: false,
  autoRescale: true,
  autoCenter: true,
  stagePadding: 50,
};

// ─── Inner event/state handler (must live inside SigmaContainer) ───────────────

interface SigmaInnerProps {
  onContextMenu?: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<{ nodeId: string; x: number; y: number } | null>>
  >;
}

function SigmaInner({ onContextMenu }: SigmaInnerProps) {
  const sigma = useSigma<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const registerEvents = useRegisterEvents<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const loadGraph = useLoadGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();

  // Keep sigma ref up-to-date
  useEffect(() => {
    sigmaRef.current = sigma;
    return () => {
      if (sigmaRef.current === sigma) sigmaRef.current = null;
    };
  }, [sigma]);

  // Load the graph on mount
  useEffect(() => {
    const graph = getOrCreateGraph();
    loadGraph(graph, false);
  }, [loadGraph]);

  // Subscribe to store changes that affect visual appearance → call refresh
  useEffect(() => {
    const unsub = useGraphStore.subscribe(
      (s) => [
        s.selectedNodeIds,
        s.focusedNodeId,
        s.connectedNodeIds,
        s.flowMode,
        s.activeNodeId,
        s.activeEdgeIds,
        s.completedNodeIds,
        s.errorNodeIds,
        s.keyboardFocusedNodeId,
        s.heatmapActive,
      ],
      () => {
        sigma.refresh();
      },
    );
    return unsub;
  }, [sigma]);

  // Register Sigma events
  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        useGraphStore.getState().selectNode(node);
        useUIStore.getState().setDetailPanelOpen(true);
        // Shift camera slightly left to make room for the Sheet panel
        const attrs = sigma.getGraph().getNodeAttributes(node);
        const { x, y } = attrs;
        sigma.getCamera().animate({ x: x - 0.04, y }, { duration: 250 });
      },

      doubleClickNode: ({ node, event }) => {
        event.original.preventDefault();
        const attrs = sigma.getGraph().getNodeAttributes(node);
        if (attrs.isGroup) {
          useGraphStore.getState().toggleGroupExpanded(node);
        }
      },

      rightClickNode: ({ node, event }) => {
        event.original.preventDefault();
        useGraphStore.getState().selectNode(node);
        if (onContextMenu?.current) {
          const me = event.original as MouseEvent;
          onContextMenu.current({
            nodeId: node,
            x: me.clientX ?? 0,
            y: me.clientY ?? 0,
          });
        }
      },

      clickStage: () => {
        useGraphStore.getState().deselectAll();
        useUIStore.getState().setDetailPanelOpen(false);
        useGraphStore.getState().setKeyboardFocusedNode(null);
      },

      doubleClickStage: ({ event }) => {
        // Prevent sigma's default double-click zoom; let camera navigate
        event.original.preventDefault();
      },

      enterNode: ({ node }) => {
        document.body.style.cursor = 'pointer';
        // Could add tooltip logic here
      },

      leaveNode: () => {
        document.body.style.cursor = '';
      },
    });
  }, [sigma, registerEvents]);

  // Keyboard navigation inside the canvas
  useCanvasNavigation();

  return null;
}

// ─── Node reducer ──────────────────────────────────────────────────────────────

function makeNodeReducer() {
  return (node: string, data: SigmaNodeAttributes): Partial<NodeDisplayData> => {
    const {
      selectedNodeIds,
      focusedNodeId,
      connectedNodeIds,
      flowMode,
      activeNodeId,
      completedNodeIds,
      errorNodeIds,
      keyboardFocusedNodeId,
    } = useGraphStore.getState();

    let { x, y, color, size, label } = data;
    let highlighted = false;
    const hidden = data.hidden ?? false;
    let forceLabel = false;
    let zIndex = 0;

    // Focus mode dimming
    if (focusedNodeId) {
      if (!connectedNodeIds.has(node)) {
        color = 'rgba(150,150,150,0.2)';
        size = Math.max(2, size * 0.4);
      } else if (node !== focusedNodeId) {
        size = size * 1.1;
        highlighted = true;
        zIndex = 1;
      }
    }

    // Selection
    if (selectedNodeIds.has(node)) {
      highlighted = true;
      size = size * 1.35;
      forceLabel = true;
      zIndex = 2;
    }

    // Flow replay state
    if (flowMode === 'replay') {
      if (activeNodeId === node) {
        color = 'oklch(0.7 0.2 195)'; // cyan — currently executing
        size = size * 1.8;
        highlighted = true;
        forceLabel = true;
        zIndex = 10;
      } else if (errorNodeIds.has(node)) {
        color = 'oklch(0.6 0.2 20)'; // red — error
        size = size * 1.2;
        zIndex = 5;
      } else if (completedNodeIds.has(node)) {
        color = 'oklch(0.45 0.05 145)'; // dim green — completed
        size = size * 0.85;
      } else {
        // Not yet reached — dim
        color = 'rgba(120,120,120,0.25)';
        size = size * 0.65;
      }
    }

    // Keyboard focus indicator
    if (keyboardFocusedNodeId === node) {
      highlighted = true;
      forceLabel = true;
      zIndex = Math.max(zIndex, 3);
    }

    return { x, y, color, size, label, highlighted, hidden, forceLabel, zIndex };
  };
}

// ─── Edge reducer ──────────────────────────────────────────────────────────────

function makeEdgeReducer() {
  return (edge: string, data: SigmaEdgeAttributes): Partial<EdgeDisplayData> => {
    const { focusedNodeId, connectedNodeIds, flowMode, activeEdgeIds } =
      useGraphStore.getState();

    let { color, size } = data;
    const hidden = data.hidden ?? false;
    let forceLabel = false;
    let zIndex = 0;

    // During focus mode, dim edges outside the focus neighbourhood
    if (focusedNodeId) {
      const graph = graphRef.current;
      if (graph) {
        const src = graph.source(edge);
        const tgt = graph.target(edge);
        if (!connectedNodeIds.has(src) || !connectedNodeIds.has(tgt)) {
          color = 'rgba(100,100,100,0.05)';
          size = Math.max(0.5, size * 0.3);
        }
      }
    }

    // Active edge during trace replay
    if (flowMode === 'replay' && activeEdgeIds.has(edge)) {
      color = 'oklch(0.7 0.2 195)'; // cyan
      size = 3;
      forceLabel = true;
      zIndex = 5;
    }

    return { color, size, hidden, forceLabel, zIndex };
  };
}

// ─── Exported wrapper ──────────────────────────────────────────────────────────

interface SigmaCanvasProps {
  onContextMenu?: React.MutableRefObject<
    React.Dispatch<React.SetStateAction<{ nodeId: string; x: number; y: number } | null>>
  >;
}

export function SigmaCanvas({ onContextMenu }: SigmaCanvasProps = {}) {
  const graph = getOrCreateGraph();
  const nodeReducer = useCallback(makeNodeReducer(), []);
  const edgeReducer = useCallback(makeEdgeReducer(), []);

  const settings: Partial<Settings<SigmaNodeAttributes, SigmaEdgeAttributes>> = {
    ...SIGMA_SETTINGS,
    nodeReducer,
    edgeReducer,
  };

  return (
    <SigmaContainer<SigmaNodeAttributes, SigmaEdgeAttributes>
      graph={graph}
      settings={settings}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      className="sigma-canvas-container"
    >
      <SigmaInner onContextMenu={onContextMenu} />
    </SigmaContainer>
  );
}
