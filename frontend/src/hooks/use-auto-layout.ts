'use client';

import type { Edge, Node } from '@xyflow/react';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';

/** Safety timeout — if ELK doesn't respond within this period, clear isLayouting */
const LAYOUT_TIMEOUT_MS = 15_000;

/**
 * Bridge to the ELK.js Web Worker for auto-layout.
 * Waits for React Flow to measure node dimensions before computing.
 */
export function useAutoLayout() {
  const { fitView } = useReactFlow();
  const workerRef = useRef<Worker | null>(null);
  const hasRunInitialLayout = useRef(false);
  const hasFittedAfterLayout = useRef(false);
  const fitViewRef = useRef(fitView);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep fitView ref up-to-date without triggering worker recreation
  useEffect(() => {
    fitViewRef.current = fitView;
  }, [fitView]);

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  }, []);

  // Initialize worker once on mount (no deps that change identity)
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
          requestAnimationFrame(() => fitViewRef.current({ duration: 400 }));
        });
      }
    };

    workerRef.current.onerror = (e) => {
      console.warn('[auto-layout] Worker error event:', e);
      clearSafetyTimer();
      useGraphStore.getState().setIsLayouting(false);
    };

    return () => {
      // Clear isLayouting on cleanup so it never gets stuck
      clearSafetyTimer();
      useGraphStore.getState().setIsLayouting(false);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [clearSafetyTimer]);

  const runLayout = useCallback(() => {
    const { nodes, edges, layoutMode } = useGraphStore.getState();
    if (nodes.length === 0 || !workerRef.current) return;

    useGraphStore.getState().setIsLayouting(true);

    // Safety timeout — if worker doesn't respond, unblock UI
    clearSafetyTimer();
    safetyTimerRef.current = setTimeout(() => {
      console.warn('[auto-layout] Layout timed out after', LAYOUT_TIMEOUT_MS, 'ms');
      useGraphStore.getState().setIsLayouting(false);
    }, LAYOUT_TIMEOUT_MS);

    workerRef.current.postMessage({
      nodes: nodes.map((n: Node) => ({
        id: n.id,
        width: n.measured?.width ?? 200,
        height: n.measured?.height ?? 80,
      })),
      edges: edges.map((e: Edge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
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

  // Auto-trigger layout once nodes are measured by React Flow.
  // Polls every 200ms until ≥80% of nodes have measured dimensions,
  // then runs layout. This avoids firing too early when nodes haven't
  // been rendered yet (all at 0,0 with no dimensions).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let pollCount = 0;
    const MAX_POLLS = 60; // 60 * 100ms = 6s safety limit

    const unsub = useGraphStore.subscribe(
      (s) => s.nodes.length,
      (length) => {
        if (length === 0 || hasRunInitialLayout.current) return;
        clearTimeout(timer);
        pollCount = 0;

        const poll = () => {
          const { nodes } = useGraphStore.getState();
          const measuredCount = nodes.filter((n) => n.measured?.width).length;
          const ratio = nodes.length > 0 ? measuredCount / nodes.length : 0;

          if (ratio >= 0.6 || pollCount >= MAX_POLLS) {
            hasRunInitialLayout.current = true;
            runLayout();
          } else {
            pollCount++;
            timer = setTimeout(poll, 100);
          }
        };

        // Start polling after a short initial delay for React Flow to begin measuring
        timer = setTimeout(poll, 150);
      },
    );
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [runLayout]);

  return { runLayout };
}
