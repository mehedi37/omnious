'use client';

import { useMemo } from 'react';
import { ArrowLeft, Clock, AlertCircle } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/trpc/client';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { TRACE_STATUS_STYLES, HTTP_METHOD_COLORS } from '@/lib/oir/constants';
import { formatDuration, formatRelativeTime } from '@/lib/utils/format';
import { SpanDetail } from './span-detail';

interface TraceTimelineProps {
  traceId: string;
}

export function TraceTimeline({ traceId }: TraceTimelineProps) {
  const router = useRouter();
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  const traceQuery = trpc.trace.getById.useQuery(
    { projectId: currentProjectId ?? '', traceId },
    { enabled: !!traceId && !!currentProjectId, staleTime: 30_000 },
  );

  const trace = traceQuery.data?.trace;
  const spans = traceQuery.data?.spans ?? [];

  // Build a waterfall by sorting spans by start time
  const sortedSpans = useMemo(
    () => [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
    [spans],
  );

  // Calculate trace time bounds for waterfall scaling
  const traceStart = sortedSpans.length > 0 ? new Date(sortedSpans[0].started_at).getTime() : 0;
  const traceEnd = sortedSpans.length > 0
    ? Math.max(
        ...sortedSpans.map((s) =>
          s.ended_at ? new Date(s.ended_at).getTime() : new Date(s.started_at).getTime() + (s.duration_ms ?? 0),
        ),
      )
    : 0;
  const traceDurationMs = traceEnd - traceStart || 1;

  if (traceQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-2 mt-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 space-y-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => router.push(`/${params.workspaceSlug}/${params.projectSlug}/traces`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">
            {trace?.root_operation ?? 'Trace Detail'}
          </h2>
          {trace?.status && (
            <Badge variant="outline" className={TRACE_STATUS_STYLES[trace.status] ?? ''}>
              {trace.status}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground pl-11">
          {trace?.http_method && (
            <Badge variant="outline" className={`font-mono text-xs ${HTTP_METHOD_COLORS[trace.http_method] ?? ''}`}>
              {trace.http_method}
            </Badge>
          )}
          {trace?.http_url && (
            <span className="font-mono text-xs truncate max-w-[400px]">{trace.http_url}</span>
          )}
          {trace?.duration_ms != null && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(trace.duration_ms)}
            </span>
          )}
          {trace?.started_at && (
            <span>{formatRelativeTime(trace.started_at)}</span>
          )}
        </div>
        {trace?.error_message && (
          <div className="flex items-start gap-2 pl-11 mt-2">
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{trace.error_message}</p>
          </div>
        )}
      </div>

      {/* Waterfall timeline */}
      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-1">
          {sortedSpans.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-12">
              No spans recorded for this trace.
            </p>
          )}
          {sortedSpans.map((span) => {
            const spanStart = new Date(span.started_at).getTime() - traceStart;
            const spanDuration = span.duration_ms ?? 0;
            const leftPercent = (spanStart / traceDurationMs) * 100;
            const widthPercent = Math.max((spanDuration / traceDurationMs) * 100, 0.5);

            return (
              <SpanDetail
                key={span.id}
                span={span as any}
                leftPercent={leftPercent}
                widthPercent={widthPercent}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
