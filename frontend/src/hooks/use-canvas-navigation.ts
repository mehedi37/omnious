'use client';

import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

/**
 * Full canvas navigation hook for React Flow.
 * Must be called inside a ReactFlowProvider context.
 *
 * Keyboard shortcuts:
 *  Arrow keys     — pan (hold Shift for large jump)
 *  + / =          — zoom in
 *  - / _          — zoom out
 *  0 / Home       — fit view (reset camera)
 *  f              — fit view
 *  F              — fit to selected nodes
 *  Escape         — layered dismiss (search → focus → deselect)
 *  Ctrl/Cmd+A     — select all visible nodes
 *  Ctrl/Cmd+F     — open node search
 *  Tab            — cycle keyboard focus to next node
 *  Shift+Tab      — cycle keyboard focus to previous node
 *  Enter          — confirm keyboard-focused node (select it)
 *  Space          — play/pause trace replay
 *  H              — toggle heatmap
 *  1              — layout top→bottom
 *  2              — layout left→right
 */

const PAN_STEP = 80;             // pixels per keypress
const PAN_STEP_LARGE = 250;      // with Shift held
const ZOOM_FACTOR = 1.4;
const ANIM_MS = 150;

export function useCanvasNavigation() {
  const reactFlow = useReactFlow();
  const focusedIndexRef = useRef<number>(-1);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs / textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const step = e.shiftKey ? PAN_STEP_LARGE : PAN_STEP;
      const viewport = reactFlow.getViewport();

      switch (e.key) {
        // ── Pan ────────────────────────────────────────────────────────────────
        case 'ArrowLeft': {
          e.preventDefault();
          reactFlow.setViewport(
            { x: viewport.x + step, y: viewport.y, zoom: viewport.zoom },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          reactFlow.setViewport(
            { x: viewport.x - step, y: viewport.y, zoom: viewport.zoom },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          reactFlow.setViewport(
            { x: viewport.x, y: viewport.y + step, zoom: viewport.zoom },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          reactFlow.setViewport(
            { x: viewport.x, y: viewport.y - step, zoom: viewport.zoom },
            { duration: ANIM_MS },
          );
          break;
        }

        // ── Zoom ───────────────────────────────────────────────────────────────
        case '+':
        case '=': {
          e.preventDefault();
          reactFlow.zoomIn({ duration: ANIM_MS });
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          reactFlow.zoomOut({ duration: ANIM_MS });
          break;
        }

        // ── Reset / fit view ──────────────────────────────────────────────────
        case '0':
        case 'Home': {
          e.preventDefault();
          reactFlow.fitView({ duration: 400 });
          break;
        }

        // ── f: fit view; F: fit to selection ──────────────────────────────────
        case 'f': {
          if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd+F → open search
            e.preventDefault();
            useGraphStore.getState().setNodeSearchOpen(true);
          } else if (e.shiftKey) {
            // Shift+F → fit selected
            fitToSelection(reactFlow);
          } else {
            reactFlow.fitView({ duration: 400 });
          }
          break;
        }

        // ── Escape: layered dismiss ─────────────────────────────────────────────
        case 'Escape': {
          const gs = useGraphStore.getState();
          if (gs.nodeSearchOpen) {
            gs.setNodeSearchOpen(false);
          } else if (gs.keyboardFocusedNodeId) {
            gs.setKeyboardFocusedNode(null);
            focusedIndexRef.current = -1;
          } else if (gs.focusedNodeId) {
            gs.clearFocusMode();
          } else if (gs.selectedNodeIds.size > 0) {
            gs.deselectAll();
            gs.highlightConnectedEdges(null);
            useUIStore.getState().setDetailPanelOpen(false);
          }
          break;
        }

        // ── Ctrl/Cmd+A: select all visible ────────────────────────────────────
        case 'a': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            useGraphStore.getState().selectAllVisible();
          }
          break;
        }

        // ── Tab: cycle keyboard focus through visible nodes ───────────────────
        case 'Tab': {
          e.preventDefault();
          const graph = graphRef.current;
          if (!graph) break;

          const visibleNodes = graph.filterNodes(
            (_, attrs) => !attrs.hidden,
          );
          if (visibleNodes.length === 0) break;

          const direction = e.shiftKey ? -1 : 1;
          const next =
            ((focusedIndexRef.current + direction) + visibleNodes.length) %
            visibleNodes.length;
          focusedIndexRef.current = next;

          const nodeId = visibleNodes[next];
          useGraphStore.getState().setKeyboardFocusedNode(nodeId);

          // Animate camera to that node
          const nodeAttrs = graph.getNodeAttributes(nodeId);
          reactFlow.setCenter(nodeAttrs.x, nodeAttrs.y, { zoom: 1.5, duration: 300 });
          break;
        }

        // ── Enter: confirm keyboard-focused node ─────────────────────────────
        case 'Enter': {
          const kfn = useGraphStore.getState().keyboardFocusedNodeId;
          if (kfn) {
            useGraphStore.getState().selectNode(kfn);
            useUIStore.getState().setDetailPanelOpen(true);
          }
          break;
        }

        // ── Space: play / pause trace replay ─────────────────────────────────
        case ' ': {
          const gs = useGraphStore.getState();
          if (gs.flowMode === 'replay') {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('omnious:toggle-replay'));
          }
          break;
        }

        // ── H: toggle heatmap ────────────────────────────────────────────────
        case 'h': {
          if (!e.ctrlKey && !e.metaKey) {
            useGraphStore.getState().toggleHeatmap();
          }
          break;
        }

        // ── 1 / 2: layout direction ──────────────────────────────────────────
        case '1': {
          useGraphStore.getState().setLayoutMode('layered-tb');
          setTimeout(() => useGraphStore.getState().requestLayout(), 50);
          break;
        }
        case '2': {
          useGraphStore.getState().setLayoutMode('layered-lr');
          setTimeout(() => useGraphStore.getState().requestLayout(), 50);
          break;
        }

        // ── N: focus mode on selected ────────────────────────────────────────
        case 'n': {
          if (!e.ctrlKey && !e.metaKey) {
            const { selectedNodeIds } = useGraphStore.getState();
            const first = selectedNodeIds.values().next().value;
            if (first) {
              useGraphStore.getState().setFocusMode(first as string);
            }
          }
          break;
        }

        // ── ?: open keyboard shortcuts dialog ─────────────────────────────────
        case '?': {
          e.preventDefault();
          useUIStore.getState().toggleKeyboardShortcuts();
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reactFlow]);
}

/** Pan + zoom the camera to frame just the selected nodes. */
function fitToSelection(reactFlow: ReturnType<typeof useReactFlow>) {
  const graph = graphRef.current;
  const { selectedNodeIds } = useGraphStore.getState();
  if (!graph || selectedNodeIds.size === 0) {
    reactFlow.fitView({ duration: 400 });
    return;
  }

  // Collect selected node IDs and use React Flow's fitView with node filter
  const nodeIds = Array.from(selectedNodeIds);
  reactFlow.fitView({
    nodes: nodeIds.map((id) => ({ id })),
    duration: 400,
    padding: 0.2,
  });
}
