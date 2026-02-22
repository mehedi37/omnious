'use client';

/**
 * Error heatmap hook.
 *
 * NOTE: Heatmap application has been moved into use-graph-data.ts which calls
 * applyErrorHeatmapToGraph() directly on the graphology graph.
 * This hook is kept as a no-op for backward compat with any existing imports.
 */
export function useErrorHeatmap() {
  // Heatmap is now applied in use-graph-data.ts via applyErrorHeatmapToGraph().
}
