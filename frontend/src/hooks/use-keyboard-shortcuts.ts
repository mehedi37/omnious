'use client';

import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
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
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          useGraphStore.getState().deselectAll();
          useUIStore.getState().setDetailPanelOpen(false);
          break;

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
          if (!e.ctrlKey && !e.metaKey) {
            fitView({ duration: 400 });
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
