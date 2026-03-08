import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock next navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/test-workspace/test-project/graph',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...props }, children),
}));

// Mock trpc
vi.mock('@/trpc/client', () => ({
  trpc: {
    auth: { me: { useQuery: () => ({ data: { display_name: 'Test User', avatar_url: null } }) } },
    workspace: {
      list: {
        useQuery: () => ({
          data: [
            {
              workspace: {
                id: 'ws-1',
                slug: 'test-workspace',
                name: 'Test Workspace',
                plan: 'free',
              },
            },
          ],
        }),
      },
    },
    project: {
      list: {
        useQuery: () => ({
          data: [{ id: 'proj-1', slug: 'test-project', name: 'Test Project' }],
        }),
      },
    },
  },
}));

// Mock workspace store
vi.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentWorkspaceId: 'ws-1',
      currentWorkspaceSlug: 'test-workspace',
      currentProjectSlug: 'test-project',
      setCurrentWorkspace: vi.fn(),
      setCurrentProject: vi.fn(),
    }),
}));

// Mock supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

// Mock child components used by AppSidebar
vi.mock('@/components/project/create-project-dialog', () => ({
  CreateProjectDialog: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/workspace/create-workspace-dialog', () => ({
  CreateWorkspaceDialog: ({ children }: { children: React.ReactNode }) => children,
}));

// We need to mock the Sidebar context since AppSidebar calls useSidebar()
const mockSidebarContext = {
  state: 'collapsed' as const,
  open: false,
  setOpen: vi.fn(),
  openMobile: false,
  setOpenMobile: vi.fn(),
  isMobile: false,
  toggleSidebar: vi.fn(),
};

vi.mock('@/components/ui/sidebar', async () => {
  const actual = await vi.importActual('@/components/ui/sidebar');
  return {
    ...actual,
    useSidebar: () => mockSidebarContext,
    Sidebar: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'sidebar', 'data-collapsible': 'icon', 'data-state': 'collapsed', className: 'group', ...props },
        children,
      ),
    SidebarHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sidebar-header' }, children),
    SidebarContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sidebar-content' }, children),
    SidebarFooter: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'sidebar-footer' }, children),
    SidebarGroup: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarGroupLabel: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarGroupContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarMenuItem: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarMenuButton: ({ children, ...props }: Record<string, unknown>) =>
      React.createElement('button', props, children as React.ReactNode),
    SidebarMenuSub: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarMenuSubButton: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarMenuSubItem: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    SidebarRail: () => React.createElement('div', { 'data-testid': 'sidebar-rail' }),
  };
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AppSidebar breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('breadcrumb container has the collapsed-hidden class', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    const { container } = render(React.createElement(AppSidebar));

    // Find the breadcrumb text
    const breadcrumbEl = screen.getByText('test-project');
    const breadcrumbContainer = breadcrumbEl.closest('div.text-xs');

    expect(breadcrumbContainer).toBeTruthy();
    expect(breadcrumbContainer?.className).toContain('group-data-[collapsible=icon]:hidden');
  });

  it('breadcrumb shows workspace/project path', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    render(React.createElement(AppSidebar));

    // "Test Workspace" appears in both the workspace switcher and breadcrumb
    expect(screen.getAllByText('Test Workspace').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('test-project')).toBeInTheDocument();
  });
});
