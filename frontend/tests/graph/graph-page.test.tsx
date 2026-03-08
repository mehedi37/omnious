import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock @xyflow/react — provides a minimal ReactFlowProvider and hooks
vi.mock('@xyflow/react', () => {
  const ReactFlowProvider = ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'rf-provider' }, children);

  const ReactFlow = (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'react-flow', ...props });

  const Background = () => React.createElement('div', { 'data-testid': 'rf-background' });
  const Controls = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'rf-controls' }, children);
  const ControlButton = (props: Record<string, unknown>) =>
    React.createElement('button', { 'data-testid': 'rf-control-button', ...props });
  const MiniMap = () => React.createElement('div', { 'data-testid': 'rf-minimap' });

  return {
    ReactFlowProvider,
    ReactFlow,
    Background,
    Controls,
    ControlButton,
    MiniMap,
    BackgroundVariant: { Dots: 'dots' },
    useReactFlow: () => ({ fitView: vi.fn() }),
    useNodesState: () => [[], vi.fn(), vi.fn()],
    useEdgesState: () => [[], vi.fn(), vi.fn()],
  };
});

// Mock trpc
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
    useGraphStore: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store },
    ),
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
    useUIStore: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store },
    ),
  };
});

vi.mock('@/lib/stores/ai-store', () => {
  const store = { panelOpen: false, openPanel: vi.fn(), closePanel: vi.fn() };
  return {
    useAIStore: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store },
    ),
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
vi.mock('@/components/graph/react-flow-canvas', () => ({
  ReactFlowCanvas: () => React.createElement('div', { 'data-testid': 'react-flow-canvas' }),
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

  it('wraps content in ReactFlowProvider', async () => {
    const { default: GraphPage } = await import(
      '@/app/dashboard/[workspaceSlug]/[projectSlug]/graph/page'
    );

    render(React.createElement(GraphPage));

    expect(screen.getByTestId('rf-provider')).toBeInTheDocument();
  });

  it('renders graph canvas when nodes exist', async () => {
    const { default: GraphPage } = await import(
      '@/app/dashboard/[workspaceSlug]/[projectSlug]/graph/page'
    );

    render(React.createElement(GraphPage));

    expect(screen.getByTestId('react-flow-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('graph-filter-toolbar')).toBeInTheDocument();
  });
});
