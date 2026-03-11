'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { SyncStatusBadge, deriveSyncState } from '@/components/project/sync-status-badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { trpc } from '@/trpc/client';

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

  const syncState = syncStatus
    ? deriveSyncState(syncStatus.status ?? 'active', syncStatus.last_indexed_at, syncStatus.node_count)
    : 'unknown';

  // Find current workspace name
  const workspaceName = workspaceSlug ?? params.workspaceSlug;

  return (
    <div className="flex h-full flex-col">
      {/* Header: breadcrumb + sync status */}
      {currentProjectSlug && (
        <div className="flex items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-3 py-1.5">
          <Breadcrumb>
            <BreadcrumbList className="text-xs">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/dashboard/${params.workspaceSlug}`}>
                    {workspaceName}
                  </Link>
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
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
