'use client';

import {
  ChevronsUpDown,
  ChevronUp,
  FolderKanban,
  GitGraph,
  LogOut,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings,
  Sun,
  UserCog,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { CreateProjectDialog } from '@/components/project/create-project-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { CreateWorkspaceDialog } from '@/components/workspace/create-workspace-dialog';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { createClient } from '@/lib/supabase/client';
import { trpc } from '@/trpc/client';

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { toggleSidebar, state: sidebarState } = useSidebar();

  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);

  // Fetch user profile
  const { data: profile } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Fetch workspaces
  const { data: workspaces } = trpc.workspace.list.useQuery(undefined, {
    staleTime: 60 * 1000,
  });

  // Fetch projects for current workspace
  const { data: projects } = trpc.project.list.useQuery(
    { workspaceId: workspaceId! },
    { enabled: !!workspaceId, staleTime: 60 * 1000 },
  );

  const displayName = profile?.display_name ?? 'Account';
  const initials =
    displayName
      .split(' ')
      .map((w: string) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U';

  // Find current workspace name
  const currentWorkspace = workspaces?.find((w) => w.workspace.id === workspaceId);
  const workspaceName = currentWorkspace?.workspace.name ?? 'Select Workspace';
  const workspacePlan = currentWorkspace?.workspace.plan ?? '';

  const isInWorkspace = !!workspaceSlug && pathname.startsWith(`/dashboard/${workspaceSlug}`);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handleWorkspaceSelect(id: string, slug: string) {
    setCurrentWorkspace(id, slug);
    router.push(`/dashboard/${slug}`);
  }

  function handleProjectSelect(id: string, slug: string) {
    setCurrentProject(id, slug);
    router.push(`/dashboard/${workspaceSlug}/${slug}/graph`);
  }

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* ── Header: Collapse + Workspace Switcher ── */}
      <SidebarHeader>
        <SidebarMenu>
          {/* Collapse/Expand toggle (icon-only) */}
          <SidebarMenuItem className="flex justify-end">
            <SidebarMenuButton onClick={toggleSidebar} tooltip="Toggle sidebar" className="ml-auto">
              {sidebarState === 'collapsed' ? (
                <PanelLeft className="size-5" />
              ) : (
                <PanelLeftClose className="size-5" />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>

          {/* Workspace switcher */}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <GitGraph className="size-4" />
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 leading-none">
                    <span className="font-semibold truncate">{workspaceName}</span>
                    {workspacePlan && (
                      <span className="text-xs text-muted-foreground capitalize">
                        {workspacePlan} plan
                      </span>
                    )}
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
              >
                {workspaces?.map((item) => (
                  <DropdownMenuItem
                    key={item.workspace.id}
                    onClick={() => handleWorkspaceSelect(item.workspace.id, item.workspace.slug)}
                  >
                    <FolderKanban className="mr-2 size-4" />
                    <span className="flex-1 truncate">{item.workspace.name}</span>
                    <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                      {item.workspace.plan}
                    </Badge>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <CreateWorkspaceDialog>
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <Plus className="mr-2 size-4" />
                    Create Workspace
                  </DropdownMenuItem>
                </CreateWorkspaceDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="flex flex-col">
        {/* ── Projects List (visible when inside a workspace) ── */}
        {isInWorkspace && (
          <SidebarGroup className="flex-1 flex flex-col min-h-0">
            <SidebarGroupLabel className="flex items-center justify-between">
              <span>Projects</span>
              {workspaceId && workspaceSlug && (
                <CreateProjectDialog workspaceId={workspaceId} workspaceSlug={workspaceSlug}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md size-5 text-muted-foreground hover:text-foreground transition-colors"
                    title="New Project"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </CreateProjectDialog>
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent className="flex-1 overflow-y-auto">
              <SidebarMenu>
                {projects?.map((project) => {
                  const isActiveProject = project.slug === projectSlug;

                  return (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton
                        isActive={isActiveProject}
                        tooltip={project.name}
                        onClick={() => handleProjectSelect(project.id, project.slug)}
                      >
                        <div className="flex aspect-square size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold uppercase shrink-0">
                          {project.name.charAt(0)}
                        </div>
                        <span className="truncate flex-1">{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* ── Footer: User Profile ── */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton>
                  <Avatar className="size-6">
                    {profile?.avatar_url && (
                      <AvatarImage src={profile.avatar_url} alt={displayName} />
                    )}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span>{displayName}</span>
                  <ChevronUp className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width]"
              >
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile">
                    <UserCog className="mr-2 size-4" />
                    Profile Settings
                  </Link>
                </DropdownMenuItem>
                {isInWorkspace && (
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/${workspaceSlug}/settings`}>
                      <Settings className="mr-2 size-4" />
                      Workspace Settings
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                  {theme === 'dark' ? (
                    <Sun className="mr-2 size-4" />
                  ) : (
                    <Moon className="mr-2 size-4" />
                  )}
                  Toggle theme
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
