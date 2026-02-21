'use client';

import { useStore } from '@xyflow/react';
import { useCallback, useEffect } from 'react';
import { ZOOM_THRESHOLDS, type ZoomLevel } from '@/lib/oir/constants';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Tracks the React Flow viewport zoom level (transform[2])
 * and derives a named ZoomLevel for level-of-detail rendering.
 */
export function useZoomLevel(): ZoomLevel {
  const zoom = useStore((s) => s.transform[2]);

  const deriveLevel = useCallback((z: number): ZoomLevel => {
    if (z < ZOOM_THRESHOLDS.service) return 'service';
    if (z < ZOOM_THRESHOLDS.module) return 'module';
    if (z < ZOOM_THRESHOLDS.function) return 'function';
    return 'detail';
  }, []);

  const level = deriveLevel(zoom);

  useEffect(() => {
    const current = useGraphStore.getState().zoomLevel;
    if (current !== level) {
      useGraphStore.getState().setZoomLevel(level);
    }
  }, [level]);

  return level;
}
