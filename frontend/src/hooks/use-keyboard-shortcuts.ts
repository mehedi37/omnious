'use client';

import { useCallback, useEffect } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

// ─── Constants ───────────────────────────────────────────────────────────────

const PAN_STEP = 50;
const PAN_STEP_LARGE = 200;

// ─── Guard: don't fire shortcuts while typing in inputs ──────────────────────

function isTyping(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Wires up all keyboard shortcuts documented in keyboard-shortcuts-dialog.tsx.
 */
export function useKeyboardShortcuts() {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Allow Ctrl/Cmd combos to pass through to their handlers even inside inputs
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // Skip if typing in a text field (except for Ctrl combos)
      if (isTyping(e) && !ctrlOrMeta) return;

      const key = e.key;
      const shift = e.shiftKey;

      // ── Ctrl/Cmd combos ────────────────────────────────────────────────

      if (ctrlOrMeta) {
        switch (key.toLowerCase()) {
          case 'f': {
            // Ctrl+F → Open node search
            e.preventDefault();
            useGraphStore.getState().setNodeSearchOpen(true);
            return;
          }
          case 'a': {
            if (shift) {
              // Ctrl+Shift+A → Toggle AI inspector tab
              e.preventDefault();
              const ui = useUIStore.getState();
              if (ui.detailPanelOpen && ui.activeDetailTab === 'ai') {
                ui.setDetailPanelOpen(false);
              } else {
                ui.setActiveDetailTab('ai');
              }
              return;
            }
            // Ctrl+A → Select all visible nodes
            if (isTyping(e)) return; // Don't override select-all in inputs
            e.preventDefault();
            const nodes = useGraphStore.getState().nodes;
            const ids = nodes.map((n) => n.id);
            if (ids.length > 0) {
              useGraphStore.getState().selectNode(ids[0]);
              for (let i = 1; i < ids.length; i++) {
                useGraphStore.getState().toggleNodeSelection(ids[i]);
              }
            }
            return;
          }
          case 'c': {
            // Ctrl+C → Copy selected node name
            if (isTyping(e)) return;
            const selectedIds = useGraphStore.getState().selectedNodeIds;
            if (selectedIds.size > 0) {
              const firstId = selectedIds.values().next().value as string;
              const node = useGraphStore.getState().nodes.find((n) => n.id === firstId);
              if (node) {
                navigator.clipboard.writeText(node.data.label);
              }
            }
            return;
          }
        }
        return; // Don't process other keys when Ctrl is held
      }

      // ── Navigation: Arrow keys — fire pan events to D3 engine ─────────

      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        if (isTyping(e)) return;
        e.preventDefault();
        const step = shift ? PAN_STEP_LARGE : PAN_STEP;
        let dx = 0, dy = 0;
        if (key === 'ArrowUp') dy = step;
        if (key === 'ArrowDown') dy = -step;
        if (key === 'ArrowLeft') dx = step;
        if (key === 'ArrowRight') dx = -step;
        window.dispatchEvent(new CustomEvent('omnious:pan', { detail: { dx, dy } }));
        return;
      }

      // ── Zoom ───────────────────────────────────────────────────────────

      if (key === '+' || key === '=') {
        if (isTyping(e)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('omnious:zoom-in'));
        return;
      }

      if (key === '-') {
        if (isTyping(e)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('omnious:zoom-out'));
        return;
      }

      if (key === '0' || key === 'Home') {
        if (isTyping(e)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
        return;
      }

      // ── Single-key shortcuts ───────────────────────────────────────────

      if (isTyping(e)) return; // Guard remaining shortcuts

      switch (key.toLowerCase()) {
        case 'f': {
          if (shift) {
            // Shift+F → Fit to selected nodes (same as fit-all in D3)
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
          } else {
            // F → Fit view
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
          }
          return;
        }

        case 'escape': {
          // Escape → dismiss in priority: search → focus → deselect
          const gs = useGraphStore.getState();
          if (gs.nodeSearchOpen) {
            gs.setNodeSearchOpen(false);
          } else if (gs.focusedNodeId) {
            gs.clearFocusMode();
            window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
          } else if (gs.selectedNodeIds.size > 0) {
            gs.deselectAll();
            useUIStore.getState().setDetailPanelOpen(false);
          }
          return;
        }

        case 'tab': {
          // Tab / Shift+Tab → Cycle focus to next/prev node
          e.preventDefault();
          const gs = useGraphStore.getState();
          const visibleNodes = gs.nodes;
          if (visibleNodes.length === 0) return;
          const currentId = gs.selectedNodeIds.values().next().value as string | undefined;
          const currentIdx = currentId ? visibleNodes.findIndex((n) => n.id === currentId) : -1;
          let nextIdx: number;
          if (shift) {
            nextIdx = currentIdx <= 0 ? visibleNodes.length - 1 : currentIdx - 1;
          } else {
            nextIdx = currentIdx >= visibleNodes.length - 1 ? 0 : currentIdx + 1;
          }
          const nextNode = visibleNodes[nextIdx];
          gs.selectNode(nextNode.id);
          // Center on the node via D3 engine custom event
          window.dispatchEvent(
            new CustomEvent('omnious:focus-node', { detail: { nodeId: nextNode.id } }),
          );
          return;
        }

        case 'enter': {
          // Enter → Confirm focused node (open detail panel)
          const selectedIds = useGraphStore.getState().selectedNodeIds;
          if (selectedIds.size > 0) {
            useUIStore.getState().setDetailPanelOpen(true);
          }
          return;
        }

        // ── Layout shortcuts ─────────────────────────────────────────────

        case '1': {
          useGraphStore.getState().setLayoutMode('layered-tb');
          return;
        }

        case '2': {
          useGraphStore.getState().setLayoutMode('layered-lr');
          return;
        }

        // ── Feature shortcuts ────────────────────────────────────────────

        case 'n': {
          // N → Toggle focus mode on selected node
          const gs = useGraphStore.getState();
          const selectedIds = gs.selectedNodeIds;
          if (selectedIds.size > 0) {
            const firstId = selectedIds.values().next().value as string;
            if (gs.focusedNodeId === firstId) {
              gs.clearFocusMode();
            } else {
              gs.setFocusMode(firstId);
            }
            window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
          }
          return;
        }

        case 'h': {
          if (shift) {
            // Shift+H → Toggle error heatmap
            useGraphStore.getState().toggleHeatmap();
          }
          // Plain H → fit (handled by D3 engine directly)
          return;
        }

        case 'l': {
          // L → Toggle pin on selected node
          const selectedIds = useGraphStore.getState().selectedNodeIds;
          if (selectedIds.size > 0) {
            const firstId = selectedIds.values().next().value as string;
            useGraphStore.getState().togglePinNode(firstId);
          }
          return;
        }

        case 'm': {
          // M → Toggle minimap
          useUIStore.getState().toggleMinimap();
          return;
        }

        case ' ': {
          // Space → Play/pause trace replay
          e.preventDefault();
          const gs = useGraphStore.getState();
          if (gs.flowMode === 'replay') {
            gs.clearFlowReplay();
          }
          return;
        }

        case '?': {
          // ? → Show keyboard shortcuts dialog
          useUIStore.getState().toggleKeyboardShortcuts();
          return;
        }
      }
    },
    [],
  );

  // Register global keydown listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

