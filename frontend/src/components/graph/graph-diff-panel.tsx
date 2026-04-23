'use client';

import { FileDiff, GitCompare, Minus, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NodeRow({
  name,
  filePath,
  type,
  kind,
}: {
  name: string;
  filePath: string;
  type: string;
  kind: 'added' | 'removed';
}) {
  const color = kind === 'added' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
  const Icon = kind === 'added' ? Plus : Minus;
  return (
    <div className="flex items-start gap-2 py-1.5 text-xs border-b last:border-0">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0">
        <p className={`font-medium truncate ${color}`}>{name}</p>
        <p className="text-muted-foreground truncate">{filePath}</p>
      </div>
      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">{type}</Badge>
    </div>
  );
}

export function GraphDiffPanel() {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  const historyQuery = trpc.graph.getPushHistory.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  );

  const history = historyQuery.data ?? [];
  const latest = history[0] ?? null;

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
        <SheetTitle className="flex items-center gap-2 text-base">
          <GitCompare className="h-4 w-4" /> What Changed?
        </SheetTitle>
        <SheetDescription className="text-xs">
          Diff between last {Math.min(history.length, 2)} pushes
        </SheetDescription>
      </SheetHeader>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3 space-y-4">
          {historyQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!historyQuery.isLoading && history.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
              <FileDiff className="h-8 w-8 opacity-40" />
              <div>
                <p className="text-sm font-medium">No push history yet</p>
                <p className="text-xs mt-1">Push your codebase twice to see a diff</p>
              </div>
            </div>
          )}

          {latest && (
            <>
              {/* Push selector */}
              <div className="flex flex-wrap gap-2">
                {history.slice(0, 5).map((entry, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      i === 0
                        ? 'bg-primary/10 border-primary/30 text-primary'
                        : 'border-border text-muted-foreground opacity-60'
                    }`}
                  >
                    {formatRelative(entry.pushed_at)}
                    {entry.hash ? ` · ${entry.hash.slice(0, 7)}` : ''}
                  </span>
                ))}
              </div>

              {/* Summary badges */}
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className="gap-1 text-green-600 border-green-500/30 bg-green-500/5">
                  <Plus className="h-3 w-3" />
                  {latest.stats.nodes_added} added
                </Badge>
                <Badge variant="outline" className="gap-1 text-red-500 border-red-500/30 bg-red-500/5">
                  <Minus className="h-3 w-3" />
                  {latest.stats.nodes_removed} removed
                </Badge>
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <FileDiff className="h-3 w-3" />
                  {latest.files_changed} files
                </Badge>
              </div>

              {/* Added nodes */}
              {latest.added.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Added ({latest.added.length})
                  </h3>
                  <div className="rounded-md border divide-y-0">
                    {latest.added.map((n) => (
                      <NodeRow
                        key={n.oir_id}
                        name={n.name}
                        filePath={n.file_path}
                        type={n.type}
                        kind="added"
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Removed nodes (only oir_ids stored — show them as ghost entries) */}
              {latest.removed_oir_ids.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Removed ({latest.removed_oir_ids.length})
                  </h3>
                  <div className="rounded-md border divide-y-0">
                    {latest.removed_oir_ids.map((oir_id) => (
                      <NodeRow
                        key={oir_id}
                        name={oir_id.split('.').pop() ?? oir_id}
                        filePath={oir_id}
                        type="unknown"
                        kind="removed"
                      />
                    ))}
                  </div>
                </section>
              )}

              {latest.added.length === 0 && latest.removed_oir_ids.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No node-level changes in this push
                </p>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
