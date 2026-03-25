'use client';

import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  ExternalLink,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

const PAGE_SIZE = 25;

export function ErrorList() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  /** errorId → AI result (null while loading) */
  const [aiSummaries, setAiSummaries] = useState<
    Record<string, { summary: string; sessionId: string | null } | null>
  >({});
  /** errorIds whose AI panel is open */
  const [aiOpen, setAiOpen] = useState<Set<string>>(new Set());

  const errorsQuery = trpc.error.list.useQuery(
    {
      projectId: currentProjectId ?? '',
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(statusFilter === 'open' ? { resolved: false } : statusFilter === 'resolved' ? { resolved: true } : {}),
      ...(severityFilter !== 'all' ? { severity: severityFilter } : {}),
    },
    { enabled: !!currentProjectId, staleTime: 10_000 },
  );

  const resolveMutation = trpc.error.resolve.useMutation({
    onSuccess: () => {
      toast.success('Error marked as resolved');
      errorsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const unresolveMutation = trpc.error.unresolve.useMutation({
    onSuccess: () => {
      toast.success('Error reopened');
      errorsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const explainMutation = trpc.ai.explainError.useMutation({
    onError: (err) => toast.error(err.message),
  });

  /** Navigate to graph page and focus on the error node */
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

  /** Request an AI explanation for the given error */
  async function handleExplain(errorId: string) {
    // Toggle open
    setAiOpen((prev) => {
      const next = new Set(prev);
      if (next.has(errorId)) {
        next.delete(errorId);
        return next;
      }
      next.add(errorId);
      return next;
    });

    // Already have a summary — just toggle visibility
    if (aiSummaries[errorId] !== undefined) return;

    // Mark as loading
    setAiSummaries((prev) => ({ ...prev, [errorId]: null }));

    try {
      const result = await explainMutation.mutateAsync({
        projectId: currentProjectId!,
        errorId,
      });
      setAiSummaries((prev) => ({ ...prev, [errorId]: result }));
    } catch {
      setAiSummaries((prev) => {
        const next = { ...prev };
        delete next[errorId];
        return next;
      });
      setAiOpen((prev) => {
        const next = new Set(prev);
        next.delete(errorId);
        return next;
      });
    }
  }

  const errors = errorsQuery.data?.errors ?? [];
  const total = errorsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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

  const detailBase = `/dashboard/${workspaceSlug}/${projectSlug}/errors`;

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 md:px-6 py-3 border-b flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search errors by message, type, or fingerprint…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(0); }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={severityFilter}
          onValueChange={(v) => { setSeverityFilter(v as typeof severityFilter); setPage(0); }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {total} error{total !== 1 ? 's' : ''}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="overflow-x-auto min-w-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Status</TableHead>
                <TableHead className="w-[80px] hidden sm:table-cell">Severity</TableHead>
                <TableHead className="w-[140px] hidden sm:table-cell">Type</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-[60px] text-right">Count</TableHead>
                <TableHead className="w-[120px] hidden md:table-cell">Node</TableHead>
                <TableHead className="w-[120px] text-right hidden sm:table-cell">
                  Last Seen
                </TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    {search ? 'No errors match your search.' : 'No errors recorded yet.'}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((error) => {
                const isResolved = !!error.resolved_at;
                const isAiOpen = aiOpen.has(error.id);
                const aiResult = aiSummaries[error.id];
                const isAiLoading = isAiOpen && aiResult === null;

                return (
                  <React.Fragment key={error.id}>
                    <TableRow className={isResolved ? 'opacity-60' : ''}>
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
                      <TableCell className="hidden sm:table-cell">
                        <Badge
                          variant="outline"
                          className={
                            error.severity === 'warning'
                              ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                              : error.severity === 'info'
                                ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                                : 'bg-red-500/20 text-red-700 dark:text-red-400'
                          }
                        >
                          {error.severity ?? 'error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {error.error_type ?? 'Unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <Link
                          href={`${detailBase}/${error.id}`}
                          className="text-sm truncate block hover:underline hover:text-foreground text-muted-foreground"
                        >
                          {error.error_message}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {formatNumber(error.occurrence_count)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] hidden md:table-cell">
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
                      <TableCell className="text-right text-xs text-muted-foreground hidden sm:table-cell">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {formatRelativeTime(error.last_seen_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          {/* AI explain toggle */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!currentProjectId}
                                onClick={() => handleExplain(error.id)}
                              >
                                {isAiLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : isAiOpen ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <BrainCircuit className="h-3 w-3" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Explain with AI</TooltipContent>
                          </Tooltip>

                          {/* Resolve / Reopen */}
                          {isResolved ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={unresolveMutation.isPending}
                              onClick={() =>
                                unresolveMutation.mutate({
                                  projectId: currentProjectId!,
                                  errorId: error.id,
                                })
                              }
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Reopen
                            </Button>
                          ) : (
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
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* AI summary expansion row */}
                    {isAiOpen && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={8} className="py-3 px-6">
                          {isAiLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Analyzing error with AI…
                            </div>
                          ) : aiResult ? (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                AI Analysis
                              </p>
                              <MarkdownRenderer content={aiResult.summary} />
                              <div className="flex items-center gap-3">
                                <Link
                                  href={`${detailBase}/${error.id}`}
                                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                >
                                  View full details <ChevronRight className="h-3 w-3" />
                                </Link>
                                {aiResult.sessionId && (
                                  <Link
                                    href={`/dashboard/${workspaceSlug}/${projectSlug}/ai?session=${aiResult.sessionId}`}
                                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    View full conversation <ExternalLink className="h-3 w-3" />
                                  </Link>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-3 md:px-6 py-2">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-3 w-3 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
