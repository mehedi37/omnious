'use client';

import { Activity, AlertCircle, ArrowRight, Clock, Play } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { HTTP_METHOD_COLORS, TRACE_STATUS_STYLES } from '@/lib/oir/constants';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { formatDuration, formatRelativeTime } from '@/lib/utils/format';
import { trpc } from '@/trpc/client';

export function TraceList() {
  const router = useRouter();
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const [search, setSearch] = useState('');

  const tracesQuery = trpc.trace.list.useQuery(
    { projectId: currentProjectId ?? '', limit: 50, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 10_000 },
  );

  const traces = tracesQuery.data?.traces ?? [];
  const filtered = search
    ? traces.filter(
        (t) =>
          t.root_operation?.toLowerCase().includes(search.toLowerCase()) ||
          t.http_url?.toLowerCase().includes(search.toLowerCase()) ||
          t.trace_id.includes(search),
      )
    : traces;

  if (tracesQuery.isLoading) {
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
          placeholder="Search traces by operation, URL, or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[80px]">Method</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>URL</TableHead>
              <TableHead className="w-[100px] text-right">Duration</TableHead>
              <TableHead className="w-[140px] text-right">Time</TableHead>
              <TableHead className="w-[40px]" />
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  {search ? 'No traces match your search.' : 'No traces recorded yet.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((trace) => (
              <TableRow
                key={trace.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() =>
                  router.push(`/${params.workspaceSlug}/${params.projectSlug}/traces/${trace.id}`)
                }
              >
                <TableCell>
                  <Badge variant="outline" className={TRACE_STATUS_STYLES[trace.status] ?? ''}>
                    {trace.status === 'error' ? (
                      <AlertCircle className="h-3 w-3 mr-1" />
                    ) : (
                      <Activity className="h-3 w-3 mr-1" />
                    )}
                    {trace.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {trace.http_method && (
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] ${HTTP_METHOD_COLORS[trace.http_method] ?? ''}`}
                    >
                      {trace.http_method}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-medium truncate max-w-[200px]">
                  {trace.root_operation ?? '—'}
                </TableCell>
                <TableCell className="font-mono text-xs truncate max-w-[200px] text-muted-foreground">
                  {trace.http_url ?? '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {trace.duration_ms != null ? formatDuration(trace.duration_ms) : '—'}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" />
                  {formatRelativeTime(trace.started_at)}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-cyan-600 hover:text-cyan-700 hover:bg-cyan-500/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          useUIStore.getState().setPendingReplayTraceId(trace.id);
                          router.push(`/${params.workspaceSlug}/${params.projectSlug}/graph`);
                        }}
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Replay on Graph</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
