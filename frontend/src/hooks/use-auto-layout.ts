'use client';

import { useCallback, useEffect, useRef } from 'react';
import { graphRef, sigmaRef, useGraphStore } from '@/lib/stores/graph-store';

/** Safety timeout — if ELK doesn't respond within this period, clear isLayouting */
const LAYOUT_TIMEOUT_MS = 15_000;

/** Fixed node sizes used when sending to ELK (no measured dimensions in Sigma) */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const GROUP_NODE_WIDTH = 240;
const GROUP_NODE_HEIGHT = 100;

/**
 * Bridge to the ELK.js Web Worker for auto-layout.
 * Uses fixed node sizes (Sigma doesn't measure nodes like React Flow).
 * Positions are written directly to the graphology graph.
 */
export function useAutoLayout() {
  const workerRef = useRef<Worker | null>(null);
  const hasRunInitialLayout = useRef(false);
  const hasFittedAfterLayout = useRef(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  // Initialize worker once on mount
  useEffect(() => {
    workerRef.current = new Worker(new URL('../../workers/elk-layout.worker.ts', import.meta.url), {
      type: 'module',
    });

    workerRef.current.onmessage = (event: MessageEvent) => {
      const { positions, error } = event.data as {
        positions: Array<{ id: string; x: number; y: number }>;
        error?: string;
      };

      clearSafetyTimer();

      if (error) {
        console.warn('[auto-layout] ELK worker error:', error);
        useGraphStore.getState().setIsLayouting(false);
        return;
      }

      if (positions.length > 0) {
        const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
        useGraphStore.getState().updateNodePositions(posMap);
      }
      useGraphStore.getState().setIsLayouting(false);

      // Only fitView on the very first layout to avoid resetting user's zoom
      if (!hasFittedAfterLayout.current) {
        hasFittedAfterLayout.current = true;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            sigmaRef.current?.getCamera().animatedReset({ duration: 400 });
          });
        });
      }
    };

    workerRef.current.onerror = (e) => {
      console.warn('[auto-layout] Worker error event:', e);
      clearSafetyTimer();
      useGraphStore.getState().setIsLayouting(false);
    };

    return () => {
      clearSafetyTimer();
      useGraphStore.getState().setIsLayouting(false);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [clearSafetyTimer]);

  const runLayout = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || graph.order === 0 || !workerRef.current) return;

    const { layoutMode } = useGraphStore.getState();
    useGraphStore.getState().setIsLayouting(true);

    // Safety timeout
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      console.warn('[auto-layout] Layout timed out after', LAYOUT_TIMEOUT_MS, 'ms');
      useGraphStore.getState().setIsLayouting(false);
    }, LAYOUT_TIMEOUT_MS);

    // Collect visible (non-hidden) nodes and their edges for ELK
    const visibleNodeIds = graph.filterNodes((_, attrs) => !attrs.hidden);
    const visibleNodeSet = new Set(visibleNodeIds);

    workerRef.current.postMessage({
      nodes: visibleNodeIds.map((id) => {
        const attrs = graph.getNodeAttributes(id);
        return {
          id,
          width: attrs.isGroup ? GROUP_NODE_WIDTH : NODE_WIDTH,
          height: attrs.isGroup ? GROUP_NODE_HEIGHT : NODE_HEIGHT,
        };
      }),
      edges: graph.filterEdges((_, attrs, src, tgt) =>
        !attrs.hidden && visibleNodeSet.has(src) && visibleNodeSet.has(tgt),
      ).map((edgeId) => {
        const src = graph.source(edgeId);
        const tgt = graph.target(edgeId);
        return { id: edgeId, source: src, target: tgt };
      }),
      layoutMode,
    });
  }, [clearSafetyTimer]);

  // Re-layout when layout mode changes
  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.layoutMode,
      () => runLayout(),
    );
  }, [runLayout]);

  // Re-layout when layoutVersion bumps (Reset Layout button)
  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.layoutVersion,
      () => runLayout(),
    );
  }, [runLayout]);

  // Auto-trigger layout once graphVersion bumps (new data pushed to graph)
  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.graphVersion,
      (version) => {
        if (version === 0 || hasRunInitialLayout.current) return;
        hasRunInitialLayout.current = true;
        runLayout();
      },
    );
  }, [runLayout]);

  return { runLayout };
}

