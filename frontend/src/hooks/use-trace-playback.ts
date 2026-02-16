'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTraceStore } from '@/lib/stores/trace-store';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Controls trace playback animation on the graph.
 * Advances through spans in time order, highlighting corresponding nodes.
 */
export function useTracePlayback() {
  const isPlaying = useTraceStore((s) => s.isPlaying);
  const playbackSpeed = useTraceStore((s) => s.playbackSpeed);
  const spans = useTraceStore((s) => s.spans);
  const playbackPosition = useTraceStore((s) => s.playbackPosition);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const tick = useCallback(() => {
    const store = useTraceStore.getState();
    if (!store.isPlaying || store.spans.length === 0) return;

    const now = performance.now();
    const delta = now - lastTickRef.current;
    const interval = 1000 / store.playbackSpeed;

    if (delta >= interval) {
      const nextPos = store.playbackPosition + 1;
      if (nextPos >= store.spans.length) {
        // End of trace — stop playback
        useTraceStore.getState().togglePlayback();
        useTraceStore.getState().setPlaybackPosition(0);
        useGraphStore.getState().deselectAll();
        return;
      }

      useTraceStore.getState().setPlaybackPosition(nextPos);

      // Highlight the node associated with the current span
      const currentSpan = store.spans[nextPos];
      if (currentSpan?.code_node_id) {
        useTraceStore.getState().setHighlightedNodeIds(new Set([currentSpan.code_node_id]));
      }

      lastTickRef.current = now;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      lastTickRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isPlaying, tick]);

  return {
    isPlaying,
    playbackPosition,
    totalSpans: spans.length,
    speed: playbackSpeed,
  };
}
