'use client';

import { AlertCircle, Check, Clock, Crosshair } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { formatNumber, formatRelativeTime } from '@/lib/utils/format';
import { trpc } from '@/trpc/client';

export function ErrorList() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');

  const errorsQuery = trpc.error.list.useQuery(
    { projectId: currentProjectId ?? '', limit: 50, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 10_000 },
  );

  const resolveMutation = trpc.error.resolve.useMutation({
    onSuccess: () => {
      toast.success('Error marked as resolved');
      errorsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  /** Navigate to graph page and focus on the error node */
  function handleFocusOnGraph(nodeId: string) {
    const graphPath = `/dashboard/${workspaceSlug}/${projectSlug}/graph`;
    // If already on the graph page, directly focus the node
    if (pathname.startsWith(graphPath)) {
      useGraphStore.getState().selectNode(nodeId);
      useGraphStore.getState().setFocusMode(nodeId);
      useGraphStore.getState().highlightConnectedEdges(nodeId);
      useUIStore.getState().setDetailPanelOpen(true);
    } else {
      // Navigate to graph — store the pending focus target so graph page can pick it up
      // We use sessionStorage as a simple cross-page signal
      sessionStorage.setItem('omnious:focus-node', nodeId);
      router.push(graphPath);
    }
  }

  const errors = errorsQuery.data?.errors ?? [];
  const filtered = search
    ? errors.filter(
        (e) =>
          e.error_message?.toLowerCase().includes(search.toLowerCase()) ||
          e.error_type?.toLowerCase().includes(search.toLowerCase()) ||
          e.fingerprint.includes(search),
      )
    : errors;

  if (errorsQuery.isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 py-3 border-b">
        <Input
          placeholder="Search errors by message, type, or fingerprint…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Status</TableHead>
              <TableHead className="w-[140px]">Type</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="w-[60px] text-right">Count</TableHead>
              <TableHead className="w-[120px]">Node</TableHead>
              <TableHead className="w-[120px] text-right">Last Seen</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  {search ? 'No errors match your search.' : 'No errors recorded yet.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((error) => {
              const isResolved = !!error.resolved_at;
              return (
                <TableRow key={error.id} className={isResolved ? 'opacity-60' : ''}>
                  <TableCell>
                    {isResolved ? (
                      <Badge
                        variant="outline"
                        className="bg-green-500/20 text-green-700 dark:text-green-400"
                      >
                        <Check className="h-3 w-3" />
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-red-500/20 text-red-700 dark:text-red-400"
                      >
                        <AlertCircle className="h-3 w-3" />
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {error.error_type ?? 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <p className="text-sm truncate">{error.error_message}</p>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">
                    {formatNumber(error.occurrence_count)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[120px]">
                    {error.code_node?.name ? (
                      <div className="flex items-center gap-1">
                        <span className="truncate">{error.code_node.name}</span>
                        {error.code_node.id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                onClick={() => handleFocusOnGraph(error.code_node!.id)}
                              >
                                <Crosshair className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Focus on graph</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {formatRelativeTime(error.last_seen_at)}
                  </TableCell>
                  <TableCell>
                    {!isResolved && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={resolveMutation.isPending}
                        onClick={() =>
                          resolveMutation.mutate({
                            projectId: currentProjectId!,
                            errorId: error.id,
                          })
                        }
                      >
                        Resolve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
