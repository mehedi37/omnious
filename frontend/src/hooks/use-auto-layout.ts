'use client';

import type { Edge, Node } from '@xyflow/react';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Bridge to the ELK.js Web Worker for auto-layout.
 * Waits for React Flow to measure node dimensions before computing.
 */
export function useAutoLayout() {
  const { fitView } = useReactFlow();
  const workerRef = useRef<Worker | null>(null);
  const hasRunInitialLayout = useRef(false);

  // Initialize worker on mount
  useEffect(() => {
    workerRef.current = new Worker(new URL('../../workers/elk-layout.worker.ts', import.meta.url), {
      type: 'module',
    });

    workerRef.current.onmessage = (event: MessageEvent) => {
      const { positions } = event.data as {
        positions: Array<{ id: string; x: number; y: number }>;
      };

      const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
      useGraphStore.getState().updateNodePositions(posMap);
      useGraphStore.getState().setIsLayouting(false);

      // Animate to fit after layout — give DOM time to reposition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => fitView({ duration: 400 }));
      });
    };

    workerRef.current.onerror = () => {
      useGraphStore.getState().setIsLayouting(false);
    };

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [fitView]);

  const runLayout = useCallback(() => {
    const { nodes, edges, layoutMode } = useGraphStore.getState();
    if (nodes.length === 0 || !workerRef.current) return;

    useGraphStore.getState().setIsLayouting(true);

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
  }, []);

  // Re-layout when layout mode changes
  useEffect(() => {
    return useGraphStore.subscribe(
      (s) => s.layoutMode,
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
    const MAX_POLLS = 50; // 50 * 200ms = 10s safety limit

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

          if (ratio >= 0.8 || pollCount >= MAX_POLLS) {
            hasRunInitialLayout.current = true;
            runLayout();
          } else {
            pollCount++;
            timer = setTimeout(poll, 200);
          }
        };

        // Start polling after a short initial delay for React Flow to begin measuring
        timer = setTimeout(poll, 300);
      },
    );
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [runLayout]);

  return { runLayout };
}
