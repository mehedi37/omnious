'use client';

import { useSigma } from '@react-sigma/core';
import { useEffect, useRef } from 'react';
import { sigmaRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

/**
 * Full canvas navigation hook for Sigma.js.
 * Must be called inside a SigmaContainer context.
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

const PAN_STEP = 0.08;           // fraction of viewport per keypress
const PAN_STEP_LARGE = 0.25;     // with Shift held
const ZOOM_FACTOR = 1.4;
const ANIM_MS = 150;

export function useCanvasNavigation() {
  const sigma = useSigma();
  const focusedIndexRef = useRef<number>(-1);

  useEffect(() => {
    if (!sigma) return;

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

      const camera = sigma.getCamera();
      const step = e.shiftKey ? PAN_STEP_LARGE : PAN_STEP;

      switch (e.key) {
        // ── Pan ────────────────────────────────────────────────────────────────
        case 'ArrowLeft': {
          e.preventDefault();
          camera.animate(
            { x: camera.x - step * camera.ratio, y: camera.y },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          camera.animate(
            { x: camera.x + step * camera.ratio, y: camera.y },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          camera.animate(
            { x: camera.x, y: camera.y - step * camera.ratio },
            { duration: ANIM_MS },
          );
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          camera.animate(
            { x: camera.x, y: camera.y + step * camera.ratio },
            { duration: ANIM_MS },
          );
          break;
        }

        // ── Zoom ───────────────────────────────────────────────────────────────
        case '+':
        case '=': {
          e.preventDefault();
          camera.animatedZoom({ factor: ZOOM_FACTOR, duration: ANIM_MS });
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          camera.animatedUnzoom({ factor: ZOOM_FACTOR, duration: ANIM_MS });
          break;
        }

        // ── Reset / fit view ──────────────────────────────────────────────────
        case '0':
        case 'Home': {
          e.preventDefault();
          camera.animatedReset({ duration: 400 });
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
            fitToSelection(sigma);
          } else {
            camera.animatedReset({ duration: 400 });
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
          const graph = sigmaRef.current?.getGraph();
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
          sigma.getCamera().animate(
            { x: nodeAttrs.x, y: nodeAttrs.y, ratio: 0.4 },
            { duration: 300 },
          );
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
          // Only active during replay — toggle isPlaying
          const gs = useGraphStore.getState();
          if (gs.flowMode === 'replay') {
            e.preventDefault();
            // Replay playback is driven by use-trace-playback; space is a no-op
            // until we wire up a shared isPlaying flag on the store.
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
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sigma]);
}

/** Pan + zoom the camera to frame just the selected nodes. */
function fitToSelection(sigma: ReturnType<typeof useSigma>) {
  const graph = sigma.getGraph();
  const { selectedNodeIds } = useGraphStore.getState();
  if (selectedNodeIds.size === 0) {
    sigma.getCamera().animatedReset({ duration: 400 });
    return;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const nodeId of selectedNodeIds) {
    if (!graph.hasNode(nodeId)) continue;
    const attrs = graph.getNodeAttributes(nodeId);
    if (attrs.hidden) continue;
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
  }

  if (!isFinite(minX)) return;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = maxX - minX + 100;
  const spanY = maxY - minY + 100;

  // Convert graph coordinates to camera ratio: larger span → larger ratio (more zoomed out)
  const { width, height } = sigma.getDimensions();
  const ratio = Math.max(spanX / width, spanY / height) * 1.1;

  sigma.getCamera().animate({ x: cx, y: cy, ratio: Math.max(ratio, 0.1) }, { duration: 400 });
}
