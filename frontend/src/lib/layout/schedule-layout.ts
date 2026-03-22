import { useGraphStore } from '@/lib/stores/graph-store';

let pendingLayoutTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesces frequent layout requests into one request to avoid worker storms.
 */
export function scheduleGraphLayout(delayMs = 16) {
  if (pendingLayoutTimer) {
    clearTimeout(pendingLayoutTimer);
  }

  pendingLayoutTimer = setTimeout(() => {
    pendingLayoutTimer = null;
    useGraphStore.getState().requestLayout();
  }, delayMs);
}

export function cancelScheduledGraphLayout() {
  if (pendingLayoutTimer) {
    clearTimeout(pendingLayoutTimer);
    pendingLayoutTimer = null;
  }
}
