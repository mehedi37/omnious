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

describe('AppSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collapse button does not render "Collapse" text label', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    render(React.createElement(AppSidebar));

    // The toggle button should not contain the text "Collapse"
    const buttons = screen.getAllByRole('button');
    const collapseBtn = buttons.find((b) => b.textContent?.trim() === 'Collapse');
    expect(collapseBtn).toBeUndefined();
  });

  it('renders project name in sidebar menu', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    render(React.createElement(AppSidebar));

    // Project name should be rendered
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });

  it('renders workspace switcher', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    render(React.createElement(AppSidebar));

    expect(screen.getByText('Test Workspace')).toBeInTheDocument();
  });

  it('breadcrumb is NOT rendered in the sidebar', async () => {
    const { AppSidebar } = await import('@/components/shared/app-sidebar');

    render(React.createElement(AppSidebar));

    // Breadcrumb was moved to project layout header
    // "test-project" as a standalone breadcrumb text should not exist
    // (project name "Test Project" exists in the project list, but the slug "test-project" does not)
    expect(screen.queryByText('test-project')).toBeNull();
  });
});
