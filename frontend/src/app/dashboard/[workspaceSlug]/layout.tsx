'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceSlug: string }>();
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const currentSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const currentId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Fetch workspace list so we can resolve slug → id
  const { data: workspaces } = trpc.workspace.list.useQuery();

  useEffect(() => {
    if (!params.workspaceSlug || !workspaces) return;

    // If slug matches and we already have an ID, skip
    if (params.workspaceSlug === currentSlug && currentId) return;

    const match = workspaces.find((w) => w.workspace.slug === params.workspaceSlug);
    if (match) {
      setCurrentWorkspace(match.workspace.id, match.workspace.slug);
    }
  }, [params.workspaceSlug, workspaces, currentSlug, currentId, setCurrentWorkspace]);

  return <>{children}</>;
}
