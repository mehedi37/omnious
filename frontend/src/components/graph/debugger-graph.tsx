'use client';
/**
 * debugger-graph.tsx
 *
 * Zero-pixi wrapper — dynamically loads the PixiJS implementation only in the
 * browser. This file intentionally has NO static imports from pixi.js,
 * @pixi/react, or pixi-viewport so that Turbopack's SSR module-graph analysis
 * never encounters those packages.
 */

import dynamic from 'next/dynamic';
import type { OmniousNode, OmniousEdge } from '@/lib/stores/graph-store';

// Props duplicated here to avoid importing from the pixi impl file
export interface DebuggerGraphProps {
  nodes: OmniousNode[];
  edges: OmniousEdge[];
  width?: number;
  height?: number;
  onNodeClick?: (nodeId: string) => void;
  className?: string;
}

/** WebGL graph canvas — browser-only, never server-rendered. */
export const DebuggerGraph = dynamic(
  () =>
    import('./debugger-graph-pixi').then((m) => m.DebuggerGraph),
  {
    ssr: false,
    loading: () => null,
  },
);
