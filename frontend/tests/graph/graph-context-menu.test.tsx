import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/stores/graph-store', () => {
  const store = {
    nodes: [],
    pinnedNodeIds: new Set(),
    setFocusMode: vi.fn(),
    togglePinNode: vi.fn(),
    selectNode: vi.fn(),
    toggleNodeTypeFilter: vi.fn(),
    clearFocusMode: vi.fn(),
    toggleHeatmap: vi.fn(),
  };
  return {
    useGraphStore: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store },
    ),
  };
});

vi.mock('@/lib/stores/ui-store', () => {
  const store = {
    minimapVisible: false,
    setActiveDetailTab: vi.fn(),
    toggleMinimap: vi.fn(),
  };
  return {
    useUIStore: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store },
    ),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useGraphContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the expected hook interface', async () => {
    const { useGraphContextMenu } = await import(
      '@/components/graph/graph-context-menu'
    );

    const { result } = renderHook(() => useGraphContextMenu());

    expect(result.current).toHaveProperty('onNodeContextMenu');
    expect(result.current).toHaveProperty('onPaneContextMenu');
    expect(result.current).toHaveProperty('setContainerRef');
    expect(result.current).toHaveProperty('menuElement');
    expect(typeof result.current.onNodeContextMenu).toBe('function');
    expect(typeof result.current.onPaneContextMenu).toBe('function');
    expect(typeof result.current.setContainerRef).toBe('function');
  });

  it('starts with no menu visible', async () => {
    const { useGraphContextMenu } = await import(
      '@/components/graph/graph-context-menu'
    );

    const { result } = renderHook(() => useGraphContextMenu());

    // No context menu initially
    expect(result.current.menuElement).toBeNull();
  });

  it('shows node context menu on right-click', async () => {
    const { useGraphContextMenu } = await import(
      '@/components/graph/graph-context-menu'
    );

    const { result } = renderHook(() => useGraphContextMenu());

    act(() => {
      const fakeEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        clientX: 100,
        clientY: 200,
      };
      const fakeNode = { id: 'node-1', data: { label: 'TestNode' } };
      result.current.onNodeContextMenu(fakeEvent as any, fakeNode as any);
    });

    // Menu should now be visible (not null)
    expect(result.current.menuElement).not.toBeNull();
  });
});
