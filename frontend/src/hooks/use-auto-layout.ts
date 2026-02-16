'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useGraphStore } from '@/lib/stores/graph-store';
import type { Node, Edge } from '@xyflow/react';

/**
 * Bridge to the ELK.js Web Worker for auto-layout.
 * Listens to layoutMode changes and triggers re-layout.
 */
export function useAutoLayout() {
  const { fitView } = useReactFlow();
  const workerRef = useRef<Worker | null>(null);

  // Initialize worker on mount
  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../../workers/elk-layout.worker.ts', import.meta.url),
      { type: 'module' },
    );

    workerRef.current.onmessage = (event: MessageEvent) => {
      const { positions } = event.data as {
        positions: Array<{ id: string; x: number; y: number }>;
      };

      const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
      useGraphStore.getState().updateNodePositions(posMap);
      useGraphStore.getState().setIsLayouting(false);

      // Animate to fit after layout
      requestAnimationFrame(() => fitView({ duration: 500 }));
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

  return { runLayout };
}
