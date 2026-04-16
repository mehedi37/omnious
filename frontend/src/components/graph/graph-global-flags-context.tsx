'use client';

import { createContext, useContext } from 'react';

/**
 * Global (graph-wide) boolean flags that every OmniousNode needs but that are
 * identical for all nodes.  Providing them via React context avoids creating
 * N × 3 separate Zustand subscriptions (one per flag per mounted node).
 */
export interface GraphGlobalFlags {
  heatmapActive: boolean;
  errorFlowActive: boolean;
  focusActive: boolean;
}

export const GraphGlobalFlagsContext = createContext<GraphGlobalFlags>({
  heatmapActive: false,
  errorFlowActive: false,
  focusActive: false,
});

export function useGraphGlobalFlags(): GraphGlobalFlags {
  return useContext(GraphGlobalFlagsContext);
}
