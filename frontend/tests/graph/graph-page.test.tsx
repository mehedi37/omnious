import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/trpc/client', () => ({
  trpc: {
    project: {
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
    },
    graph: {
      listNodes: { useQuery: () => ({ data: { total: 5 }, isLoading: false }) },
    },
  },
}));

// Mock stores
vi.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentProjectId: 'test-project-id',
      currentProjectSlug: 'test-project',
      currentWorkspaceSlug: 'test-workspace',
    }),
}));

vi.mock('@/lib/stores/graph-store', () => {
  const store = {
    nodes: [],
    edges: [],
    isLayouting: false,
    selectedNodeIds: new Set(),
    focusedNodeId: null,
    connectedNodeIds: new Set(),
    nodeTypeFilters: new Set(),
    severityFilters: new Set(),
    pinnedNodeIds: new Set(),
    heatmapActive: false,
    selectNode: vi.fn(),
    deselectAll: vi.fn(),
    pinAll: vi.fn(),
    unpinAll: vi.fn(),
    setFocusMode: vi.fn(),
    togglePinNode: vi.fn(),
    toggleNodeTypeFilter: vi.fn(),
    toggleSeverityFilter: vi.fn(),
    toggleHeatmap: vi.fn(),
    clearFocusMode: vi.fn(),
    highlightConnectedEdges: vi.fn(),
  };
  return {
    useGraphStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
      getState: () => store,
    }),
  };
});

vi.mock('@/lib/stores/ui-store', () => {
  const store = {
    minimapVisible: true,
    detailPanelOpen: false,
    setDetailPanelOpen: vi.fn(),
    toggleMinimap: vi.fn(),
    setActiveDetailTab: vi.fn(),
  };
  return {
    useUIStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
      getState: () => store,
    }),
  };
});

vi.mock('@/lib/stores/ai-store', () => {
  const store = {
    projectId: null,
    activeSessionId: null,
    sessionType: null,
    messages: [],
    isStreaming: false,
    prefillMessage: null,
    setProjectId: vi.fn(),
    setPrefillMessage: vi.fn(),
  };
  return {
    useAIStore: Object.assign((selector: (s: typeof store) => unknown) => selector(store), {
      getState: () => store,
    }),
  };
});

// Mock hooks used by graph page
vi.mock('@/hooks/use-graph-query', () => ({
  useGraphQuery: () => ({
    isLoading: false,
    isQuerying: false,
    queryGraph: vi.fn(),
    showErrors: vi.fn(),
    loadOverview: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/hooks/use-error-heatmap', () => ({
  useErrorHeatmap: vi.fn(),
}));

// Mock child components
vi.mock('@/components/graph/d3/d3-graph-canvas', () => ({
  D3GraphCanvas: () => React.createElement('div', { 'data-testid': 'd3-graph-canvas' }),
}));

// Also mock the dynamic import wrapper
vi.mock('@/components/graph/debugger-graph', () => ({
  DebuggerGraph: () => React.createElement('div', { 'data-testid': 'd3-graph-canvas' }),
}));

vi.mock('@/components/graph/graph-filter-toolbar', () => ({
  GraphFilterToolbar: () => React.createElement('div', { 'data-testid': 'graph-filter-toolbar' }),
}));

vi.mock('@/components/ai/unified-ai-panel', () => ({
  UnifiedAIPanel: () => React.createElement('div', { 'data-testid': 'ai-panel' }),
}));

vi.mock('@/components/graph/panels/node-detail-panel', () => ({
  NodeDetailPanel: () => React.createElement('div', { 'data-testid': 'node-detail-panel' }),
}));

vi.mock('@/components/project/empty-project-state', () => ({
  EmptyProjectState: () => React.createElement('div', { 'data-testid': 'empty-state' }),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GraphPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing (no memoizedState error)', async () => {
    // Dynamically import after all mocks are set up
    const { default: GraphPage } = await import(
      '@/app/dashboard/[workspaceSlug]/[projectSlug]/graph/page'
    );

    const { container } = render(React.createElement(GraphPage));

    // The page should render — no crash
    expect(container).toBeTruthy();
  });

  it('renders graph canvas when nodes exist', async () => {
    const { default: GraphPage } = await import(
      '@/app/dashboard/[workspaceSlug]/[projectSlug]/graph/page'
    );

    render(React.createElement(GraphPage));

    expect(screen.getByTestId('d3-graph-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('graph-filter-toolbar')).toBeInTheDocument();
  });
});
