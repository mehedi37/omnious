'use client';

import { Activity, AlertTriangle, Bot, GitGraph, LayoutDashboard, Settings } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { deriveSyncState, SyncStatusBadge } from '@/components/project/sync-status-badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/client';

const PROJECT_TABS = [
  { title: 'Overview', icon: LayoutDashboard, segment: '' },
  { title: 'Graph', icon: GitGraph, segment: 'graph' },
  { title: 'Traces', icon: Activity, segment: 'traces' },
  { title: 'Errors', icon: AlertTriangle, segment: 'errors' },
  { title: 'AI', icon: Bot, segment: 'ai' },
  { title: 'Settings', icon: Settings, segment: 'settings' },
] as const;

function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return 'Never';
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const pathname = usePathname();
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);
  const currentProjectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  // Fetch projects to resolve slug → id
  const { data: projects } = trpc.project.list.useQuery(
    { workspaceId: workspaceId! },
    { enabled: !!workspaceId },
  );

  // Fetch sync status for the current project
  const { data: syncStatus } = trpc.project.getSyncStatus.useQuery(
    { projectId: currentProjectId! },
    { enabled: !!currentProjectId, refetchInterval: 30_000 },
  );

  useEffect(() => {
    if (!params.projectSlug || !projects) return;
    if (params.projectSlug === currentProjectSlug && currentProjectId) return;

    const match = projects.find((p) => p.slug === params.projectSlug);
    if (match) {
      setCurrentProject(match.id, match.slug);
    }
  }, [params.projectSlug, projects, currentProjectSlug, currentProjectId, setCurrentProject]);

  // Clear AI session state when project changes
  useEffect(() => {
    useAIStore.getState().setProjectId(currentProjectId);
  }, [currentProjectId]);

  const syncState = syncStatus
    ? deriveSyncState(
        syncStatus.status ?? 'active',
        syncStatus.last_indexed_at,
        syncStatus.node_count,
      )
    : 'unknown';

  // Find current workspace name
  const workspaceName = workspaceSlug ?? params.workspaceSlug;
  const basePath = `/dashboard/${params.workspaceSlug}/${params.projectSlug}`;

  return (
    <div className="flex h-full flex-col">
      {/* Header: breadcrumb + sync status + tab bar */}
      {currentProjectSlug && (
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Breadcrumb>
              <BreadcrumbList className="text-xs">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link href={`/dashboard/${params.workspaceSlug}`}>{workspaceName}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{currentProjectSlug}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-2">
              <SyncStatusBadge syncState={syncState} compact />
              {syncStatus?.last_indexed_at && (
                <span className="text-[10px] text-muted-foreground">
                  {formatRelativeTime(syncStatus.last_indexed_at)}
                </span>
              )}
            </div>
          </div>
          {/* Project tab navigation */}
          <nav className="flex items-center gap-0.5 px-3 pb-1">
            {PROJECT_TABS.map((tab) => {
              const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
              const isActive = tab.segment
                ? pathname.startsWith(`${basePath}/${tab.segment}`)
                : pathname === basePath || pathname === `${basePath}/`;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.segment || 'overview'}
                  href={href}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {tab.title}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      <div className="flex-1 overflow-hidden min-h-0">{children}</div>
    </div>
  );
}
