'use client';

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  ExternalLink,
  FileCode,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { formatNumber, formatRelativeTime } from '@/lib/utils/format';
import { trpc } from '@/trpc/client';

interface Props {
  errorId: string;
}

export function ErrorDetail({ errorId }: Props) {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const router = useRouter();
  const pathname = usePathname();


  const errorQuery = trpc.error.getById.useQuery(
    { projectId: currentProjectId ?? '', errorId },
    { enabled: !!currentProjectId },
  );

  // Lightweight sibling list for prev/next navigation
  const siblingsQuery = trpc.error.list.useQuery(
    { projectId: currentProjectId ?? '', limit: 100, offset: 0 },
    { enabled: !!currentProjectId, staleTime: 30_000 },
  );
  const siblingIds = (siblingsQuery.data?.errors ?? []).map((e) => e.id);
  const siblingIdx = siblingIds.indexOf(errorId);
  const prevId = siblingIdx > 0 ? siblingIds[siblingIdx - 1] : null;
  const nextId = siblingIdx >= 0 && siblingIdx < siblingIds.length - 1 ? siblingIds[siblingIdx + 1] : null;

  const resolveMutation = trpc.error.resolve.useMutation({
    onSuccess: () => {
      toast.success('Error resolved');
      errorQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const unresolveMutation = trpc.error.unresolve.useMutation({
    onSuccess: () => {
      toast.success('Error reopened');
      errorQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const narrativeMutation = trpc.ai.generateIncidentNarrative.useMutation({
    onError: () => { /* silently skip if AI not configured */ },
  });

  // Auto-generate narrative on first view if not yet cached
  useEffect(() => {
    if (!currentProjectId || !errorQuery.data) return;
    const meta = errorQuery.data.metadata as Record<string, unknown> | null;
    if (meta?.narrative) return;
    if (narrativeMutation.isPending || narrativeMutation.isSuccess) return;
    narrativeMutation.mutate({ projectId: currentProjectId, errorId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, errorQuery.data?.id]);

  function handleFocusOnGraph(nodeId: string) {
    const graphPath = `/dashboard/${workspaceSlug}/${projectSlug}/graph`;
    if (pathname.startsWith(graphPath)) {
      useGraphStore.getState().selectNode(nodeId);
      useGraphStore.getState().setFocusMode(nodeId);
      useGraphStore.getState().highlightConnectedEdges(nodeId);
      useUIStore.getState().setDetailPanelOpen(true);
    } else {
      sessionStorage.setItem('omnious:focus-node', nodeId);
      router.push(graphPath);
    }
  }

  if (errorQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!errorQuery.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto" />
          <p>Error not found</p>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            Go back
          </Button>
        </div>
      </div>
    );
  }

  const err = errorQuery.data;
  const node = err.code_node as Record<string, unknown> | null;
  const trace = err.trace as Record<string, unknown> | null;
  const isResolved = !!err.resolved_at;

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isResolved ? (
              <Badge
                variant="outline"
                className="bg-green-500/20 text-green-700 dark:text-green-400 shrink-0"
              >
                <Check className="h-3 w-3 mr-1" />
                Resolved
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="bg-red-500/20 text-red-700 dark:text-red-400 shrink-0"
              >
                <AlertCircle className="h-3 w-3 mr-1" />
                Open
              </Badge>
            )}
            <Badge variant="secondary" className="font-mono text-[11px] shrink-0">
              {err.error_type ?? 'Unknown'}
            </Badge>
            <Badge variant="outline" className="text-[11px] shrink-0 capitalize">
              {err.source ?? 'runtime'}
            </Badge>
          </div>
          <h1 className="text-lg font-semibold leading-snug break-all">{err.error_message}</h1>
        </div>
        <div className="flex gap-2 shrink-0">
          {/* Prev / Next navigation */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!prevId}
            title="Previous error"
            onClick={() =>
              router.push(`/dashboard/${workspaceSlug}/${projectSlug}/errors/${prevId}`)
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!nextId}
            title="Next error"
            onClick={() =>
              router.push(`/dashboard/${workspaceSlug}/${projectSlug}/errors/${nextId}`)
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {isResolved ? (
            <Button
              variant="outline"
              size="sm"
              disabled={unresolveMutation.isPending}
              onClick={() => unresolveMutation.mutate({ projectId: currentProjectId!, errorId })}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reopen
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ projectId: currentProjectId!, errorId })}
            >
              <Check className="h-3 w-3 mr-1" />
              Resolve
            </Button>
          )}
        </div>
      </div>

      {/* Incident Narrative Card */}
      {(() => {
        const cachedNarrative = (err.metadata as Record<string, unknown> | null)?.narrative as
          | { title: string; story: string; blastRadius: string[]; likelyFix: string; confidence: 'high' | 'medium' | 'low' }
          | undefined;
        const narrative = narrativeMutation.data ?? cachedNarrative;
        const isLoading = narrativeMutation.isPending && !narrative;

        if (!isLoading && !narrative) return null;

        const CONFIDENCE_STYLES = {
          high: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
          medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
          low: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
        };

        return (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                Incident Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : narrative ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-semibold leading-snug">{narrative.title}</h3>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0 capitalize ${CONFIDENCE_STYLES[narrative.confidence]}`}
                    >
                      {narrative.confidence} confidence
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{narrative.story}</p>
                  {narrative.blastRadius.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Blast Radius
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {narrative.blastRadius.map((name) => (
                          <span
                            key={name}
                            className="text-xs font-mono px-2 py-0.5 bg-muted rounded-md border"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {narrative.likelyFix && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Likely Fix
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed bg-muted/50 rounded-md p-2 border">
                        {narrative.likelyFix}
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })()}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Occurrences</p>
            <p className="text-2xl font-bold">{formatNumber(err.occurrence_count)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">First Seen</p>
            <p className="text-sm font-medium mt-1">{formatRelativeTime(err.first_seen_at)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Last Seen</p>
            <p className="text-sm font-medium mt-1">{formatRelativeTime(err.last_seen_at)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stack trace */}
      {err.error_stack && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Stack Trace</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed bg-muted/40 rounded p-3 max-h-80 overflow-y-auto">
              {err.error_stack}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Linked code node */}
      {node && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Linked Code Node
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="font-mono text-xs capitalize">
                {String(node.type ?? '')}
              </Badge>
              <span className="font-medium text-sm">{String(node.name ?? '')}</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              {String(node.file_path ?? '')}
              {node.line_start ? `:${String(node.line_start)}` : ''}
              {node.line_end && node.line_end !== node.line_start
                ? `–${String(node.line_end)}`
                : ''}
            </p>
            {!!node.signature && (
              <pre className="text-xs font-mono bg-muted/40 rounded p-2 overflow-x-auto">
                {String(node.signature)}
              </pre>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFocusOnGraph(String(node.id ?? ''))}
            >
              <Crosshair className="h-3 w-3 mr-2" />
              Focus on graph
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Linked trace */}
      {trace && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">From Trace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs">
                {String(trace.http_method ?? 'UNKNOWN')}
              </Badge>
              <span className="text-xs font-mono text-muted-foreground truncate">
                {String(trace.http_url ?? '')}
              </span>
              {!!trace.http_status && (
                <Badge
                  variant="outline"
                  className={
                    Number(trace.http_status) >= 500
                      ? 'text-red-600 border-red-300'
                      : 'text-yellow-600 border-yellow-300'
                  }
                >
                  {String(trace.http_status)}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <Clock className="h-3 w-3 inline mr-1" />
              {formatRelativeTime(String(trace.started_at ?? ''))}
              {!!trace.duration_ms && ` · ${String(trace.duration_ms)}ms`}
            </p>
            <Link
              href={`/dashboard/${workspaceSlug}/${projectSlug}/traces/${String(trace.id ?? '')}`}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              View trace <ExternalLink className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Metadata / fingerprint */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-xs">
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Fingerprint</span>
            <span className="font-mono break-all">{err.fingerprint}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Error ID</span>
            <span className="font-mono text-muted-foreground">{err.id}</span>
          </div>
          {err.span_otel_id && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-24 shrink-0">Span ID</span>
              <span className="font-mono">{err.span_otel_id}</span>
            </div>
          )}
          {err.metadata && Object.keys(err.metadata as object).length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-muted-foreground mb-1">Metadata</p>
              <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto">
                {JSON.stringify(err.metadata, null, 2)}
              </pre>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
