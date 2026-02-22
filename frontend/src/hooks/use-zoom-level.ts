'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ZOOM_THRESHOLDS, type ZoomLevel } from '@/lib/oir/constants';
import { sigmaRef, useGraphStore } from '@/lib/stores/graph-store';

/**
 * Tracks the Sigma camera ratio and derives a named ZoomLevel.
 * Sigma camera ratio: smaller = more zoomed in, larger = more zoomed out.
 *
 * We map ratio → equivalent "React Flow zoom" to reuse existing ZOOM_THRESHOLDS:
 *   rfZoom ≈ 1 / camera.ratio
 */
export function useZoomLevel(): ZoomLevel {
  const levelRef = useRef<ZoomLevel>('function');

  const deriveLevel = useCallback((ratio: number): ZoomLevel => {
    const zoom = 1 / ratio; // Convert sigma ratio to equivalent RF zoom
    if (zoom < ZOOM_THRESHOLDS.service) return 'service';
    if (zoom < ZOOM_THRESHOLDS.module) return 'module';
    if (zoom < ZOOM_THRESHOLDS.function) return 'function';
    return 'detail';
  }, []);

  useEffect(() => {
    // Poll camera on interval — sigma emits "updated" events but they're not
    // exposed through @react-sigma/core's hook API. 100ms polling is cheap.
    const interval = setInterval(() => {
      const sigma = sigmaRef.current;
      if (!sigma) return;

      const ratio = sigma.getCamera().ratio;
      const level = deriveLevel(ratio);

      if (level !== levelRef.current) {
        levelRef.current = level;
        const current = useGraphStore.getState().zoomLevel;
        if (current !== level) {
          useGraphStore.getState().setZoomLevel(level);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [deriveLevel]);

  return useGraphStore((s) => s.zoomLevel);
}
