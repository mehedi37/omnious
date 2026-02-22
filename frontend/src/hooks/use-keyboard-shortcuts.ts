'use client';

/**
 * Global keyboard shortcuts for the graph view.
 *
 * NOTE: All keyboard shortcuts have been migrated to use-canvas-navigation.ts
 * which runs inside the SigmaContainer and has access to the sigma camera.
 * This hook is kept as a no-op for backward compat with graph-canvas.tsx imports.
 */
export function useKeyboardShortcuts() {
  // All shortcuts are now handled by useCanvasNavigation() inside SigmaInner.
  // See: frontend/src/hooks/use-canvas-navigation.ts
}
