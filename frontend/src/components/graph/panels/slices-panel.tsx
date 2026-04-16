'use client';

import { Clock3, ExternalLink, Layers, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SlicesPanel() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);

  const slicesQuery = trpc.ai.listGraphSlices.useQuery(
    { projectId: projectId ?? '', limit: 20 },
    {
      enabled: !!projectId,
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const utils = trpc.useUtils();

  const deleteSliceMutation = trpc.ai.deleteGraphSlice.useMutation({
    onSuccess: () => {
      utils.ai.listGraphSlices.invalidate({ projectId: projectId ?? '' });
    },
  });

  const slices = slicesQuery.data?.slices ?? [];

  if (!projectId || !workspaceSlug || !projectSlug) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        No project selected
      </div>
    );
  }

  if (slicesQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        Loading slices...
      </div>
    );
  }

  if (slices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">No AI slices yet</p>
        <p className="text-[10px] text-muted-foreground/60">
          Ask the AI a question about your code to generate a graph slice
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium text-muted-foreground">
          <Layers className="h-3 w-3" />
          {slices.length} slice{slices.length !== 1 ? 's' : ''}
        </div>
        {slices.map((slice) => {
          const href = `/dashboard/${workspaceSlug}/${projectSlug}/graph?ai_gen=${slice.viewId}`;
          return (
            <div
              key={slice.viewId}
              className="group flex items-start gap-2 rounded-lg border border-border/40 bg-background/60 p-2 transition-colors hover:bg-accent/50"
            >
              <div className="flex-1 min-w-0">
                <Link
                  href={href}
                  className="block text-xs font-medium truncate hover:underline"
                  title={slice.description ?? slice.name}
                >
                  {slice.name}
                </Link>
                {slice.description && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground line-clamp-2">
                    {slice.description}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
                  <span className="flex items-center gap-0.5">
                    <Clock3 className="h-2.5 w-2.5" />
                    {formatRelativeTime(slice.updatedAt)}
                  </span>
                  {slice.isShared && (
                    <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">shared</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Open slice"
                >
                  <Link href={href}>
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </Button>
                {slice.isOwnedByCurrentUser && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    title="Delete slice"
                    onClick={() => deleteSliceMutation.mutate({
                      projectId,
                      viewId: slice.viewId,
                    })}
                    disabled={deleteSliceMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
