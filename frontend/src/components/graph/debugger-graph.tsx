'use client';
/**
 * debugger-graph.tsx
 *
 * Browser-only D3 canvas graph. Dynamically imported so SSR never attempts
 * to run canvas code on the server.
 */

import dynamic from 'next/dynamic';

/** D3 canvas graph — browser-only, never server-rendered. */
export const DebuggerGraph = dynamic(
  () => import('./d3/d3-graph-canvas').then((m) => m.D3GraphCanvas),
  {
    ssr: false,
    loading: () => null,
  },
);
