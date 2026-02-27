'use client';

import { useEffect } from 'react';
import { GraphCanvas } from '@/components/graph/graph-canvas';
import { EmptyProjectState } from '@/components/project/empty-project-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

export default function GraphPage() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const projectQuery = trpc.project.getById.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  );

  const nodeCountQuery = trpc.graph.listNodes.useQuery(
    { projectId: projectId ?? '', limit: 1, offset: 0 },
    { enabled: !!projectId, staleTime: 30_000 },
  );

  // While projectId is null the store hasn't hydrated yet from localStorage —
  // treat that as loading to avoid a flash of the empty state.
  const isLoading =
    !projectId ||
    nodeCountQuery.isLoading ||
    projectQuery.isLoading;

  const hasNodes = (nodeCountQuery.data?.total ?? 0) > 0;

  // Pick up focus-node from sessionStorage (coming from error list "Focus on Graph")
  useEffect(() => {
    if (!hasNodes) return;
    const focusNodeId = sessionStorage.getItem('omnious:focus-node');
    if (focusNodeId) {
      sessionStorage.removeItem('omnious:focus-node');
      // Delay to allow graph to render first
      const timer = setTimeout(() => {
        useGraphStore.getState().selectNode(focusNodeId);
        useGraphStore.getState().setFocusMode(focusNodeId);
        useGraphStore.getState().highlightConnectedEdges(focusNodeId);
        useUIStore.getState().setDetailPanelOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hasNodes]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-16 w-16 rounded-full mx-auto" />
          <Skeleton className="h-4 w-48 mx-auto" />
          <Skeleton className="h-3 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!hasNodes) {
    return (
      <div className="h-full overflow-auto">
        <EmptyProjectState
          projectName={projectQuery.data?.name ?? projectSlug ?? 'Project'}
          projectSlug={projectSlug ?? ''}
          apiKey={projectQuery.data?.api_key ?? null}
          workspaceSlug={workspaceSlug ?? ''}
        />
      </div>
    );
  }

  return (
    <div className="h-full">
      <GraphCanvas />
    </div>
  );
}
