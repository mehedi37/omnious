'use client';

import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  FolderKanban,
  GitGraph,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { CreateProjectDialog } from '@/components/project/create-project-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { CreateWorkspaceDialog } from '@/components/workspace/create-workspace-dialog';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { createClient } from '@/lib/supabase/client';
import { trpc } from '@/trpc/client';

/** In-project navigation items */
const projectNavItems = [
  { title: 'Graph', icon: GitGraph, segment: 'graph' },
  { title: 'Traces', icon: Activity, segment: 'traces' },
  { title: 'Errors', icon: AlertTriangle, segment: 'errors' },
  { title: 'AI Sessions', icon: Bot, segment: 'ai' },
  { title: 'Settings', icon: Settings, segment: 'settings' },
];

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
  const basePath = workspaceSlug && projectSlug ? `/dashboard/${workspaceSlug}/${projectSlug}` : '';

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
      {/* ── Header: Collapse + Workspace Switcher + Breadcrumb ── */}
      <SidebarHeader>
        <SidebarMenu>
          {/* Collapse/Expand toggle */}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar} tooltip="Toggle sidebar">
              {sidebarState === 'collapsed' ? (
                <PanelLeft className="size-5" />
              ) : (
                <PanelLeftClose className="size-5" />
              )}
              <span>Collapse</span>
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

        {/* Breadcrumb (shown when inside a project, hidden in icon-collapsed mode) */}
        {projectSlug && isInWorkspace && (
          <div className="text-xs text-muted-foreground px-2 py-1 group-data-[collapsible=icon]:hidden">
            <div className="wrap-break-word">
              <Link
                href={`/dashboard/${workspaceSlug}`}
                className="hover:text-foreground transition-colors"
              >
                {workspaceName}
              </Link>
              <span className="mx-1 opacity-50">/</span>
              <span className="font-medium text-foreground">{projectSlug}</span>
            </div>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* ── Projects List (visible when inside a workspace) ── */}
        {isInWorkspace && (
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <ScrollArea className="max-h-70 overflow-x-hidden">
                <SidebarMenu>
                  {projects?.map((project) => {
                    const isActiveProject = project.slug === projectSlug;

                    return (
                      <Collapsible key={project.id} defaultOpen={isActiveProject} asChild>
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton
                              isActive={isActiveProject}
                              tooltip={project.name}
                              onClick={() => handleProjectSelect(project.id, project.slug)}
                            >
                              <div className="flex aspect-square size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold uppercase shrink-0">
                                {project.name.charAt(0)}
                              </div>
                              <span className="truncate">{project.name}</span>
                              {isActiveProject && (
                                <ChevronDown className="ml-auto size-4 transition-transform" />
                              )}
                              {!isActiveProject && (
                                <ChevronRight className="ml-auto size-4 opacity-0 group-hover/menu-item:opacity-100 transition-opacity" />
                              )}
                            </SidebarMenuButton>
                          </CollapsibleTrigger>

                          {/* In-project nav (shown under active project) */}
                          {isActiveProject && (
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {projectNavItems.map((item) => {
                                  const href = `${basePath}/${item.segment}`;
                                  const isActive = pathname.startsWith(href);

                                  return (
                                    <SidebarMenuSubItem key={item.segment}>
                                      <SidebarMenuSubButton asChild isActive={isActive}>
                                        <Link href={href}>
                                          <item.icon className="size-4" />
                                          <span>{item.title}</span>
                                        </Link>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  );
                                })}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          )}
                        </SidebarMenuItem>
                      </Collapsible>
                    );
                  })}

                  {/* New Project button */}
                  {workspaceId && workspaceSlug && (
                    <SidebarMenuItem>
                      <CreateProjectDialog workspaceId={workspaceId} workspaceSlug={workspaceSlug}>
                        <SidebarMenuButton className="text-muted-foreground">
                          <Plus className="size-4" />
                          <span>New Project</span>
                        </SidebarMenuButton>
                      </CreateProjectDialog>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </ScrollArea>
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
                {isInWorkspace && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link href={`/dashboard/${workspaceSlug}/settings`}>
                        <Settings className="mr-2 size-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
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
