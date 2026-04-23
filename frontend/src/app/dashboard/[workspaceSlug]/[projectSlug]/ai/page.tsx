'use client';

import { Brain, Bug, GitGraph, History, Languages, MessageSquare, Plus, Shield, Sparkles, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { UnifiedAIPanel } from '@/components/ai/unified-ai-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AISessionType } from '@/lib/oir/types';
import type { AIMessage } from '@/lib/stores/ai-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/client';

const SESSION_ICONS: Record<AISessionType, LucideIcon> = {
  explain_flow: Brain,
  why_broke: Bug,
  fix_it: Wrench,
  general: MessageSquare,
  security_scan: Shield,
  translate: Languages,
  graph_query: GitGraph,
};

const SESSION_LABELS: Record<AISessionType, string> = {
  explain_flow: 'Explain Flow',
  why_broke: 'Why Broke',
  fix_it: 'Fix It',
  general: 'Chat',
  security_scan: 'Security Scan',
  translate: 'Translate',
  graph_query: 'Graph Query',
};

function formatRelativeTime(iso: string): string {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return '';
  const diffMs = Date.now() - target;
  const absSec = Math.round(diffMs / 1000);
  if (absSec < 60) return 'just now';
  const absMin = Math.round(absSec / 60);
  if (absMin < 60) return `${absMin}m ago`;
  const absHour = Math.round(absMin / 60);
  if (absHour < 24) return `${absHour}h ago`;
  return `${Math.round(absHour / 24)}d ago`;
}

export default function AIPage() {
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const clearSession = useAIStore((s) => s.clearSession);
  const setActiveSession = useAIStore((s) => s.setActiveSession);
  const utils = trpc.useUtils();
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'timeline'>('sessions');

  const sessionsQuery = trpc.ai.listSessions.useQuery(
    { projectId: currentProjectId ?? '', limit: 40 },
    { enabled: !!currentProjectId, staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const insightsQuery = trpc.ai.listInsights.useQuery(
    { projectId: currentProjectId ?? '', limit: 60 },
    { enabled: !!currentProjectId && sidebarTab === 'timeline', staleTime: 60_000 },
  );

  const handleNewChat = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const handleNewSession = useCallback(() => {
    void sessionsQuery.refetch();
  }, [sessionsQuery]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) return;
      try {
        const session = await utils.ai.getSession.fetch({ sessionId });
        const messages = Array.isArray(session.messages)
          ? (session.messages as unknown as AIMessage[])
          : [];
        setActiveSession(sessionId, (session.type as AISessionType) ?? 'general', messages);
      } catch {
        // ignore – session may have been deleted
      }
    },
    [activeSessionId, utils, setActiveSession],
  );

  return (
    <div className="flex h-[calc(100vh-6rem)]">
      {/* ── Session sidebar ───────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/20">
        <div className="p-3 border-b space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </Button>
          {/* Sidebar tab switcher */}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSidebarTab('sessions')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                sidebarTab === 'sessions'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <MessageSquare className="h-3 w-3" /> Sessions
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('timeline')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                sidebarTab === 'timeline'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <History className="h-3 w-3" /> Timeline
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {/* Sessions list */}
          {sidebarTab === 'sessions' && (
            <div className="py-1">
              {sessionsQuery.isLoading && (
                <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>
              )}
              {!sessionsQuery.isLoading && sessionsQuery.data?.sessions.length === 0 && (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  No sessions yet. Start a new chat!
                </p>
              )}
              {sessionsQuery.data?.sessions.map((s) => {
                const type = s.type as AISessionType;
                const Icon = SESSION_ICONS[type] ?? MessageSquare;
                const isActive = s.id === activeSessionId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void handleSelectSession(s.id)}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60',
                      isActive && 'bg-accent',
                    )}
                  >
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="truncate text-xs font-medium leading-tight">
                        {SESSION_LABELS[type] ?? type}
                      </div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {formatRelativeTime(s.updated_at)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Knowledge Timeline */}
          {sidebarTab === 'timeline' && (
            <div className="py-2 px-2 space-y-2">
              {insightsQuery.isLoading && (
                <p className="px-2 py-3 text-xs text-muted-foreground">Loading timeline…</p>
              )}
              {!insightsQuery.isLoading && (insightsQuery.data?.insights.length ?? 0) === 0 && (
                <div className="px-2 py-4 text-center">
                  <Sparkles className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No insights yet. Insights are generated automatically during AI sessions.
                  </p>
                </div>
              )}
              {insightsQuery.data?.insights.map((insight) => {
                const categoryColors: Record<string, string> = {
                  bug: 'bg-red-500/10 text-red-600 border-red-500/20',
                  security: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
                  performance: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
                  architecture: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                  pattern: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
                  general: 'bg-muted text-muted-foreground border-border',
                };
                const insightType = insight.insight_type ?? 'general';
                const colorClass = categoryColors[insightType] ?? categoryColors.general;
                const payload = insight.payload as Record<string, unknown> | null;
                const summary = (payload?.summary ?? payload?.content ?? payload?.text ?? '') as string;
                return (
                  <div
                    key={insight.id}
                    className="rounded-md border bg-card p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn('text-[9px] h-4 px-1 capitalize', colorClass)}
                      >
                        {insightType.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {formatRelativeTime(insight.created_at)}
                      </span>
                    </div>
                    {summary && (
                      <p className="text-[11px] leading-relaxed text-foreground/80">
                        {String(summary).slice(0, 300)}
                      </p>
                    )}
                  </div>
                );
              })}
              {(insightsQuery.data?.total ?? 0) > 60 && (
                <p className="text-[10px] text-center text-muted-foreground py-1">
                  Showing 60 most recent insights
                </p>
              )}
            </div>
          )}
        </ScrollArea>
      </aside>

      {/* ── Chat panel ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <UnifiedAIPanel mode="standalone" onNewSession={handleNewSession} />
      </div>
    </div>
  );
}
