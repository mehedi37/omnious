'use client';

/**
 * IndexedDB-backed query persister for TanStack React Query.
 * Caches graph data across page navigations so workspace switches feel instant.
 *
 * Uses idb-keyval for a simple key-value IndexedDB store.
 * Only graph-related queries (graph.listNodes, graph.listEdges, error.heatmap)
 * are persisted — auth/mutation caches are excluded.
 */

import { get, set, del } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

const IDB_KEY = 'omnious-query-cache';

/**
 * Max age for persisted cache — 24 hours.
 * After this, the cache is discarded and data is re-fetched from server.
 */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

/**
 * Buster string — bump this to force-invalidate all persisted caches.
 * Change when you make breaking schema changes to query responses.
 */
export const PERSIST_BUSTER = 'v1';

/**
 * Create an async persister backed by IndexedDB via idb-keyval.
 */
export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set(IDB_KEY, client);
      } catch {
        // IndexedDB can fail in incognito or when storage is full — silently ignore
      }
    },
    restoreClient: async () => {
      try {
        return await get<PersistedClient>(IDB_KEY);
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del(IDB_KEY);
      } catch {
        // noop
      }
    },
  };
}
