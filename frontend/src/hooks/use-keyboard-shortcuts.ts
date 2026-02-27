'use client';

import { useCanvasNavigation } from './use-canvas-navigation';

/**
 * Global keyboard shortcuts for the graph view.
 * Delegates to useCanvasNavigation which handles all keyboard shortcuts
 * inside the ReactFlowProvider context.
 */
export function useKeyboardShortcuts() {
  useCanvasNavigation();
}
