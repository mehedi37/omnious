'use client';

import { GitBranch, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { CreateProjectDialog } from './create-project-dialog';
import { deriveSyncState, SyncStatusBadge } from './sync-status-badge';

export function ProjectList({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);

  const { data: projects, isLoading } = trpc.project.list.useQuery(
    { workspaceId: workspaceId! },
    { enabled: !!workspaceId },
  );

  if (isLoading || !workspaceId) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects?.map((project) => (
        <Card
          key={project.id}
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => {
            setCurrentProject(project.id, project.slug);
            router.push(`/dashboard/${workspaceSlug}/${project.slug}`);
          }}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{project.name}</CardTitle>
              <SyncStatusBadge compact syncState={deriveSyncState(project.status)} />
            </div>
            <CardDescription>{project.description ?? 'No description'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {project.primary_language && <span>{project.primary_language}</span>}
              {project.framework && <span>· {project.framework}</span>}
              {project.git_branch && (
                <span className="flex items-center gap-1">
                  <GitBranch className="size-3" />
                  {project.git_branch}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <CreateProjectDialog workspaceId={workspaceId} workspaceSlug={workspaceSlug}>
        <Card className="flex cursor-pointer items-center justify-center border-dashed transition-colors hover:border-primary/50">
          <CardHeader className="items-center">
            <Plus className="mb-2 size-8 text-muted-foreground" />
            <CardTitle className="text-sm text-muted-foreground">New Project</CardTitle>
          </CardHeader>
        </Card>
      </CreateProjectDialog>
    </div>
  );
}
