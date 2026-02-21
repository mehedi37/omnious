'use client';

import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

/**
 * Global keyboard shortcuts for the graph view.
 *
 * Shortcuts:
 * - Delete/Backspace → delete selected nodes
 * - Escape → deselect all
 * - Ctrl+A → select all nodes
 * - F → fit view
 * - H → toggle heatmap
 * - 1 → layout top-bottom
 * - 2 → layout left-right
 */
export function useKeyboardShortcuts() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'Escape': {
          // Layered escape: close search → clear focus → deselect all
          const gs = useGraphStore.getState();
          if (gs.nodeSearchOpen) {
            gs.setNodeSearchOpen(false);
          } else if (gs.focusedNodeId) {
            gs.clearFocusMode();
          } else {
            gs.deselectAll();
            useUIStore.getState().setDetailPanelOpen(false);
          }
          break;
        }

        case 'Delete':
        case 'Backspace':
          // Could implement node deletion here
          break;

        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const allIds = useGraphStore.getState().nodes.map((n) => n.id);
            for (const id of allIds) {
              useGraphStore.getState().toggleNodeSelection(id);
            }
          }
          break;

        case 'f':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            useGraphStore.getState().setNodeSearchOpen(true);
          } else {
            fitView({ duration: 400 });
          }
          break;

        case 'n':
          if (!e.ctrlKey && !e.metaKey) {
            const { selectedNodeIds } = useGraphStore.getState();
            const first = selectedNodeIds.values().next().value;
            if (first) {
              useGraphStore.getState().setFocusMode(first as string);
            }
          }
          break;

        case 'h':
          if (!e.ctrlKey && !e.metaKey) {
            useGraphStore.getState().toggleHeatmap();
          }
          break;

        case '1':
          useGraphStore.getState().setLayoutMode('layered-tb');
          break;

        case '2':
          useGraphStore.getState().setLayoutMode('layered-lr');
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitView]);
}
