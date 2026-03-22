'use client';

import { Brain, Bug, GitGraph, Languages, MessageSquare, Plus, Shield, Wrench } from 'lucide-react';
import { useCallback } from 'react';
import { UnifiedAIPanel } from '@/components/ai/unified-ai-panel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AISessionType } from '@/lib/oir/types';
import type { AIMessage } from '@/lib/stores/ai-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/client';

const SESSION_ICONS: Record<AISessionType, React.ElementType> = {
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

  const sessionsQuery = trpc.ai.listSessions.useQuery(
    { projectId: currentProjectId ?? '', limit: 40 },
    { enabled: !!currentProjectId, staleTime: 30_000, refetchOnWindowFocus: false },
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
        <div className="p-3 border-b">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </Button>
        </div>

        <ScrollArea className="flex-1">
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
        </ScrollArea>
      </aside>

      {/* ── Chat panel ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        <UnifiedAIPanel mode="standalone" onNewSession={handleNewSession} />
      </div>
    </div>
  );
}
