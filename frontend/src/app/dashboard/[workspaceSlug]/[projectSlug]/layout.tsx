'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/trpc/client';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject);
  const currentProjectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Fetch projects to resolve slug → id
  const { data: projects } = trpc.project.list.useQuery(
    { workspaceId: workspaceId! },
    { enabled: !!workspaceId },
  );

  useEffect(() => {
    if (!params.projectSlug || !projects) return;
    if (params.projectSlug === currentProjectSlug && currentProjectId) return;

    const match = projects.find((p) => p.slug === params.projectSlug);
    if (match) {
      setCurrentProject(match.id, match.slug);
    }
  }, [params.projectSlug, projects, currentProjectSlug, currentProjectId, setCurrentProject]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
