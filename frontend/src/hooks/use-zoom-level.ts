'use client';

import type { ZoomLevel } from '@/lib/oir/constants';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Returns the current zoom level.
 * Zoom tracking is now handled inside FlowCanvas via useOnViewportChange,
 * so this hook simply reads the derived value from the store.
 */
export function useZoomLevel(): ZoomLevel {
  return useGraphStore((s) => s.zoomLevel);
}
