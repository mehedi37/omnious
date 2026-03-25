'use client';

import { useEffect, useRef } from 'react';
import { NODE_SIZE_DIMENSIONS, useGraphStore } from '@/lib/stores/graph-store';

const LAYOUT_TIMEOUT_MS = 20_000;

type LayoutResponse = {
  requestId: number;
  positions: Array<{ id: string; x: number; y: number }>;
  edgeRoutes: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
  error?: string;
};

/**
 * Hook that connects the graph store to the ELK layout web worker.
 * Subscribes to `layoutVersion` changes and dispatches layout computations.
 * Must be mounted inside a component that renders the graph canvas.
 */
export function useElkLayout() {
  const workerRef = useRef<Worker | null>(null);
  const latestRequestIdRef = useRef(0);
  const settledRequestIdsRef = useRef<Set<number>>(new Set());
  const pendingRequestIdsRef = useRef<Set<number>>(new Set());
  const timeoutMapRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Web Worker is only available in browser environments
    if (typeof Worker === 'undefined') return;

    // Create the worker
    const worker = new Worker(new URL('../../workers/elk-layout.worker.ts', import.meta.url));
    workerRef.current = worker;

    function clearTimeoutForRequest(requestId: number) {
      const timeout = timeoutMapRef.current.get(requestId);
      if (timeout) {
        clearTimeout(timeout);
        timeoutMapRef.current.delete(requestId);
      }
    }

    function settleRequest(requestId: number) {
      if (settledRequestIdsRef.current.has(requestId)) {
        return;
      }

      settledRequestIdsRef.current.add(requestId);
      clearTimeoutForRequest(requestId);
      pendingRequestIdsRef.current.delete(requestId);

      if (pendingRequestIdsRef.current.size === 0) {
        useGraphStore.getState().setIsLayouting(false);
      }
    }

    function resetAllPending(reason: string) {
      for (const timeout of timeoutMapRef.current.values()) {
        clearTimeout(timeout);
      }
      timeoutMapRef.current.clear();
      pendingRequestIdsRef.current.clear();
      settledRequestIdsRef.current.clear();
      useGraphStore.getState().setIsLayouting(false);
      console.warn(`[elk-layout] Reset pending layout state: ${reason}`);
    }

    // Handle worker results
    worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
      const { requestId, positions, error } = e.data;

      try {
        if (settledRequestIdsRef.current.has(requestId)) {
          return;
        }

        if (requestId < latestRequestIdRef.current) {
          return;
        }

        if (error) {
          console.warn('[elk-layout] Worker error:', error);
          return;
        }

        const store = useGraphStore.getState();

        // Apply computed positions to nodes
        const posMap = new Map(positions.map((p) => [p.id, p]));
        const updated = store.nodes.map((node) => {
          const pos = posMap.get(node.id);
          if (!pos) return node;
          return { ...node, position: { x: pos.x, y: pos.y } };
        });

        store.setNodes(updated);

        // Trigger a fitView after positions settle
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
        });
      } catch (err) {
        console.error('[elk-layout] Failed to apply worker layout result', err);
      } finally {
        settleRequest(requestId);
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      console.error('[elk-layout] Worker runtime error:', e.message);
      resetAllPending('worker error');
    };

    worker.onmessageerror = () => {
      console.error('[elk-layout] Worker message deserialization error');
      resetAllPending('worker message error');
    };

    // Subscribe to layoutVersion changes using zustand subscribeWithSelector
    const unsub = useGraphStore.subscribe(
      (s) => s.layoutVersion,
      (version) => {
        if (version === 0) return;
        const { nodes, edges, layoutMode } = useGraphStore.getState();
        if (nodes.length === 0) return;

        // For trivial graphs (0-1 node), skip the worker entirely
        if (nodes.length <= 1) {
          const trivialPositions = nodes.map((n) => ({ id: n.id, x: 0, y: 0 }));
          const store = useGraphStore.getState();
          const updated = store.nodes.map((node) => {
            const pos = trivialPositions.find((p) => p.id === node.id);
            if (!pos) return node;
            return { ...node, position: { x: pos.x, y: pos.y } };
          });
          store.setNodes(updated);
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
          });
          return;
        }

        const requestId = latestRequestIdRef.current + 1;
        latestRequestIdRef.current = requestId;
        pendingRequestIdsRef.current.add(requestId);
        useGraphStore.getState().setIsLayouting(true);

        const timeout = setTimeout(() => {
          console.warn(
            `[elk-layout] Layout request ${requestId} timed out after ${LAYOUT_TIMEOUT_MS}ms`,
          );
          settleRequest(requestId);
        }, LAYOUT_TIMEOUT_MS);
        timeoutMapRef.current.set(requestId, timeout);

        try {
          // Post layout request to worker
          worker.postMessage({
            requestId,
            nodes: nodes.map((n) => {
              const tier = n.data.sizeTier ?? 'medium';
              const dims = NODE_SIZE_DIMENSIONS[tier];
              return {
                id: n.id,
                width: dims.width,
                height: dims.height,
                group: n.data.filePath
                  ? n.data.filePath.split('/').slice(0, -1).join('/')
                  : undefined,
              };
            }),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
            })),
            layoutMode,
          });
        } catch (err) {
          console.error('[elk-layout] Failed to post layout request to worker', err);
          settleRequest(requestId);
        }
      },
    );

    return () => {
      unsub();
      resetAllPending('hook cleanup');
      worker.terminate();
      workerRef.current = null;
    };
  }, []);
}
