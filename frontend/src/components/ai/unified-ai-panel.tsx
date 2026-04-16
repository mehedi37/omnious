'use client';

import {
  Brain,
  Bug,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  Map,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { streamChat } from '@/hooks/use-ai-chat';
import type { AISessionType } from '@/lib/oir/types';
import type { AIMessageAttachment } from '@/lib/stores/ai-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { AIMessage } from './ai-message';
import { AIQuickActions } from './ai-quick-actions';
import { AIStreamingIndicator } from './ai-streaming-indicator';
import { AIContextBadge } from './ai-context-badge';
import { type MentionEntry, MentionTextarea } from './mention-textarea';

// ─── Types ───────────────────────────────────────────────────

type ModelTier = 'auto' | 'fast' | 'powerful';

interface UnifiedAIPanelProps {
  /** 'graph' = inside graph page (uses callbacks). 'standalone' = AI sessions page (uses tRPC + SSE). */
  mode: 'graph' | 'standalone';
  /** Graph-mode callbacks (ignored in standalone mode) */
  onQuery?: (
    query: string,
    contextNodeIds?: string[],
    apiKeyId?: string,
    modelPreference?: ModelTier,
    attachments?: AIMessageAttachment[],
  ) => void;
  onShowErrors?: () => void;
  onLoadOverview?: () => void;
  isQuerying?: boolean;
  onClose?: () => void;
  /** Called after a new session is created so the parent can refresh its session list */
  onNewSession?: (sessionId: string) => void;
}

// ─── Quick actions for graph mode ────────────────────────────

const GRAPH_QUICK_ACTIONS = [
  {
    label: 'How does this project work?',
    icon: Brain,
    query: 'Explain the overall architecture and how this project works',
  },
  { label: 'Show me the errors', icon: Bug, query: '__errors__' },
  {
    label: 'Key dependencies',
    icon: GitBranch,
    query: 'Show the key dependencies and how the main modules connect',
  },
  { label: 'Back to overview', icon: Map, query: '__overview__' },
] as const;

const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  auto: 'Auto',
  fast: 'Fast',
  powerful: 'Powerful',
};

function formatRelativeTime(iso: string): string {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return 'recently';
  const diffMs = target - Date.now();
  const absSec = Math.abs(Math.round(diffMs / 1000));
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  const absMin = Math.round(absSec / 60);
  if (absMin < 60) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  const absHour = Math.round(absMin / 60);
  if (absHour < 24) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  const absDay = Math.round(absHour / 24);
  if (absDay < 30) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  return rtf.format(Math.round(diffMs / (86_400_000 * 30)), 'month');
}

function parseMentionFilterBadges(step: string | null): string[] {
  if (!step) return [];
  const prefix = 'Mention filters applied:';
  if (!step.startsWith(prefix)) return [];
  return step
    .slice(prefix.length)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseFirstSampleFromFilterBadge(badge: string): string | null {
  const match = /\(([^)]+)\)/.exec(badge);
  if (!match?.[1]) return null;

  const first = match[1]
    .split(',')[0]
    ?.trim()
    .replace(/^`|`$/g, '')
    .replace(/\.\.\.$/, '');

  return first && first.length > 0 ? first : null;
}

function prefillTokenFromFilterBadge(badge: string): string {
  const kind = badge.split(':')[0]?.trim().toLowerCase();
  const sample = parseFirstSampleFromFilterBadge(badge);
  if (!kind) return '#';
  if (kind === 'node') {
    return sample ? `#${sample}` : '#';
  }
  if (kind === 'module' || kind === 'function' || kind === 'file' || kind === 'error') {
    if (sample) return `#${kind}:${sample}`;
    return `#${kind}:`;
  }
  return '#';
}

// ─── Component ───────────────────────────────────────────────

export function UnifiedAIPanel({
  mode,
  onQuery,
  onShowErrors,
  onLoadOverview,
  isQuerying = false,
  onClose,
  onNewSession,
}: UnifiedAIPanelProps) {
  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>('auto');
  const [copiedSliceKey, setCopiedSliceKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useAIStore((s) => s.messages);
  const isStreaming = useAIStore((s) => s.isStreaming);
  const tokenUsage = useAIStore((s) => s.tokenUsage);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const prefillMessage = useAIStore((s) => s.prefillMessage);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);
  const workspaceSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const projectSlug = useWorkspaceStore((s) => s.currentProjectSlug);

  // Graph-mode extras
  const querySteps = useGraphStore((s) => s.querySteps);
  const latestSliceId = useGraphStore((s) => s.latestSliceId);
  const shareNextSlice = useGraphStore((s) => s.shareNextSlice);
  const setShareNextSlice = useGraphStore((s) => s.setShareNextSlice);
  const nodeCount = useGraphStore((s) => s.nodes).length;
  const edgeCount = useGraphStore((s) => s.edges).length;
  const aiSessionsHref =
    workspaceSlug && projectSlug ? `/dashboard/${workspaceSlug}/${projectSlug}/ai` : null;
  const latestSliceHref =
    workspaceSlug && projectSlug && latestSliceId
      ? `/dashboard/${workspaceSlug}/${projectSlug}/graph?ai_gen=${latestSliceId}`
      : null;

  const recentSlicesQuery = trpc.ai.listGraphSlices.useQuery(
    {
      projectId: currentProjectId ?? '',
      limit: 6,
    },
    {
      enabled: mode === 'graph' && !!currentProjectId,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  // Standalone-mode tRPC mutations (persist messages to DB)
  const createSessionMutation = trpc.ai.createSession.useMutation();
  const appendMessageMutation = trpc.ai.appendMessage.useMutation();

  const isBusy = isQuerying || isStreaming || createSessionMutation.isPending;
  const mentionFilterStep =
    mode === 'graph'
      ? ([...querySteps].reverse().find((step) => step.startsWith('Mention filters applied:')) ??
        null)
      : null;
  const mentionFilterBadges = parseMentionFilterBadges(mentionFilterStep);

  const handleMentionFilterBadgeClick = useCallback((badge: string) => {
    const token = prefillTokenFromFilterBadge(badge);
    setInput((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return token;
      if (trimmed.endsWith(token)) return prev;
      return `${prev}${prev.endsWith(' ') ? '' : ' '}${token}`;
    });
    textareaRef.current?.focus();
  }, []);

  // Auto-scroll to bottom when near bottom, or force-scroll during active streaming
  const lastContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 120;
    if (isNearBottom || isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, lastContent, querySteps.length, isStreaming]);

  // Toast when AI response completes
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.content) {
        const snippet = last.content.length > 80 ? `${last.content.slice(0, 80)}…` : last.content;
        toast.success(snippet, { duration: 3000 });
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, messages]);

  // Listen for omnious:prefill-ai event (from graph context menu "Ask AI About This")
  useEffect(() => {
    if (mode !== 'graph') return;
    function handlePrefill(e: Event) {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      if (detail?.text) {
        setInput(detail.text);
        textareaRef.current?.focus();
      }
    }
    window.addEventListener('omnious:prefill-ai', handlePrefill);
    return () => window.removeEventListener('omnious:prefill-ai', handlePrefill);
  }, [mode]);

  // Consume prefillMessage from store (set by "Ask AI" buttons in node detail)
  useEffect(() => {
    if (prefillMessage) {
      setInput(prefillMessage);
      useAIStore.getState().setPrefillMessage(null);
      textareaRef.current?.focus();
    }
  }, [prefillMessage]);

  // ── Send handler ─────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    setInput('');

    const attachments: AIMessageAttachment[] = mentions.map((m) => ({
      kind: m.kind,
      id: m.id,
      label: m.label,
      subtype: m.subtype,
    }));
    setMentions([]);

    if (mode === 'graph') {
      const contextNodeIds = mentions
        .filter((m) => m.kind === 'node' || m.kind === 'module' || m.kind === 'function')
        .map((m) => m.id)
        .filter((id) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
        );
      onQuery?.(
        trimmed,
        contextNodeIds.length > 0 ? contextNodeIds : undefined,
        undefined,
        modelTier !== 'auto' ? modelTier : undefined,
        attachments.length > 0 ? attachments : undefined,
      );
      return;
    }

    // ── Standalone mode: create/reuse session, persist user msg, stream AI response ──
    if (!currentProjectId) return;

    // When mentions are present, append a context note so the LLM knows what was tagged.
    // The raw message already contains the #label text; this adds kind/subtype info.
    let standaloneContent = trimmed;
    if (attachments.length > 0) {
      const ctx = attachments
        .map((a) => `  - ${a.label}${a.subtype ? ` (${a.subtype})` : ''} [${a.kind}]`)
        .join('\n');
      standaloneContent = `${trimmed}\n\n[Tagged context:\n${ctx}]`;
    }

    useAIStore.getState().addMessage({
      role: 'user',
      content: trimmed,          // store readable content (no annotation) in UI
      timestamp: new Date().toISOString(),
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const session = await createSessionMutation.mutateAsync({
          projectId: currentProjectId,
          type: 'general',
          modelPreference: modelTier !== 'auto' ? modelTier : undefined,
        });
        sessionId = session.id;
        useAIStore.getState().setActiveSession(sessionId, 'general');
        onNewSession?.(sessionId);
      } catch {
        // Session creation failed; use a temporary ID so streaming still works
        sessionId = crypto.randomUUID();
        useAIStore.getState().setActiveSession(sessionId, 'general');
      }
    }

    // Persist user message best-effort (fire-and-forget)
    appendMessageMutation.mutate({
      sessionId,
      messages: [{ role: 'user', content: trimmed, timestamp: new Date().toISOString() }],
    });

    // Stream AI response — replace the last user message content with the annotated version
    // so the LLM sees the tagged context, while the UI shows the clean message.
    const allMessages = useAIStore
      .getState()
      .messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m, _i, arr) => ({
        role: m.role as 'user' | 'assistant',
        // Last user message gets the annotated content; all others pass through unchanged
        content: m === arr[arr.length - 1] && m.role === 'user' ? standaloneContent : m.content,
      }));

    try {
      await streamChat(allMessages, sessionId, currentProjectId, modelTier);
    } catch (err) {
      // Replace the empty assistant message (seeded by streamChat) with the error
      const msgs = useAIStore.getState().messages;
      const lastIdx = msgs.length - 1;
      if (msgs[lastIdx]?.role === 'assistant' && msgs[lastIdx]?.content === '') {
        useAIStore.getState().addMessage({
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'AI request failed. Check that Ollama is running.'}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }, [
    input,
    isBusy,
    mode,
    mentions,
    onQuery,
    currentProjectId,
    activeSessionId,
    modelTier,
    createSessionMutation,
    appendMessageMutation,
    onNewSession,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // ── Graph-mode quick actions ─────────────────────────────

  const handleGraphQuickAction = useCallback(
    (query: string) => {
      if (query === '__errors__') {
        onShowErrors?.();
      } else if (query === '__overview__') {
        onLoadOverview?.();
      } else {
        onQuery?.(query);
      }
    },
    [onQuery, onShowErrors, onLoadOverview],
  );

  // ── Standalone-mode quick actions ────────────────────────

  const handleStandaloneQuickAction = useCallback(
    async (sessionType: AISessionType, prompt: string) => {
      if (!currentProjectId) return;

      const sessionId = crypto.randomUUID();
      useAIStore.getState().setActiveSession(sessionId, sessionType);
      useAIStore
        .getState()
        .addMessage({ role: 'user', content: prompt, timestamp: new Date().toISOString() });

      try {
        await createSessionMutation.mutateAsync({
          projectId: currentProjectId,
          type: sessionType,
          modelPreference: modelTier !== 'auto' ? modelTier : undefined,
        });
        onNewSession?.(sessionId);
      } catch {
        // best-effort
      }

      appendMessageMutation.mutate({
        sessionId,
        messages: [{ role: 'user', content: prompt, timestamp: new Date().toISOString() }],
      });

      try {
        await streamChat(
          [{ role: 'user', content: prompt }],
          sessionId,
          currentProjectId,
          modelTier,
        );
      } catch (err) {
        useAIStore.getState().addMessage({
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'AI request failed.'}`,
          timestamp: new Date().toISOString(),
        });
      }
    },
    [currentProjectId, modelTier, createSessionMutation, appendMessageMutation, onNewSession],
  );

  const copySliceHref = useCallback(async (href: string, key: string) => {
    if (typeof window === 'undefined') return;
    const absoluteUrl = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopiedSliceKey(key);
      window.setTimeout(() => setCopiedSliceKey((prev) => (prev === key ? null : prev)), 1400);
    } catch {
      window.prompt('Copy graph slice URL', absoluteUrl);
    }
  }, []);

  const handleCopySliceLink = useCallback(async () => {
    if (!latestSliceHref) return;
    await copySliceHref(latestSliceHref, 'latest');
  }, [latestSliceHref, copySliceHref]);

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b bg-linear-to-r from-background to-primary/5 px-4 py-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/20">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">
          {mode === 'graph' ? 'AI Graph Explorer' : 'AI Assistant'}
        </h3>
        {mode === 'graph' && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {shareNextSlice ? 'Shared' : 'Private'}
          </Badge>
        )}
        {mode === 'graph' && latestSliceHref && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Copy latest graph slice link"
            onClick={handleCopySliceLink}
          >
            {copiedSliceKey === 'latest' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {mode === 'graph' && aiSessionsHref && (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Open AI session page"
          >
            <Link href={aiSessionsHref}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
        {mode === 'graph' && nodeCount > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {nodeCount} nodes · {edgeCount} edges
          </span>
        )}
        {mode === 'graph' && nodeCount === 0 && (
          <span className="ml-auto" />
        )}
        <AIContextBadge />
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 ml-1"
            onClick={onClose}
            title="Close AI panel (Ctrl+Shift+A)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Scrollable content area */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="space-y-4 p-4">
          {/* Quick actions (shown when no messages) */}
          {messages.length === 0 && mode === 'graph' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground/80 leading-relaxed">
                Ask anything about your codebase. The AI will find relevant code and show it on the
                graph.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {GRAPH_QUICK_ACTIONS.map((action) => (
                  <Button
                    key={action.label}
                    variant="ghost"
                    size="sm"
                    className="h-auto rounded-full border border-border/60 bg-muted/40 px-3 py-1.5 text-xs gap-1.5 hover:bg-muted hover:border-border"
                    onClick={() => handleGraphQuickAction(action.query)}
                    disabled={isBusy}
                  >
                    <action.icon className="h-3 w-3 opacity-60" />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {mode === 'graph' &&
            recentSlicesQuery.data?.slices &&
            recentSlicesQuery.data.slices.length > 0 &&
            workspaceSlug &&
            projectSlug && (
              <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Clock3 className="h-3 w-3" />
                  Recent AI slices
                </div>
                <div className="space-y-1">
                  {recentSlicesQuery.data.slices.map((slice) => {
                    const href = `/dashboard/${workspaceSlug}/${projectSlug}/graph?ai_gen=${slice.viewId}`;
                    const copied = copiedSliceKey === slice.viewId;
                    return (
                      <div
                        key={slice.viewId}
                        className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-background/60 px-2 py-1.5"
                      >
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-6 min-w-0 flex-1 justify-start px-1.5 text-left"
                          title={slice.description ?? slice.name}
                        >
                          <Link href={href}>
                            <span className="truncate text-[11px]">{slice.name}</span>
                          </Link>
                        </Button>
                        <span
                          className="shrink-0 text-[9px] text-muted-foreground"
                          title={slice.updatedAt}
                        >
                          {formatRelativeTime(slice.updatedAt)}
                        </span>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          {slice.isShared ? 'Shared' : 'Private'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => void copySliceHref(href, slice.viewId)}
                          title="Copy slice link"
                        >
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {messages.length === 0 && mode === 'standalone' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="rounded-2xl bg-linear-to-br from-primary/15 to-primary/5 p-5 ring-1 ring-primary/20">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">How can I help?</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Ask about your codebase, debug errors, explain data flows, or scan for security
                  issues. Type <code className="rounded bg-muted px-1 py-0.5 text-xs">#</code> to
                  mention a file, module, or function.
                </p>
              </div>
              <AIQuickActions onAction={handleStandaloneQuickAction} />
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <AIMessage
              key={`${msg.role}-${i}`}
              message={msg}
              showCursor={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
            />
          ))}

          {/* Loading/thinking indicator — stage-aware when streaming */}
          {(isQuerying || createSessionMutation.isPending || isStreaming) && (
            <AIStreamingIndicator />
          )}
          {(isQuerying || createSessionMutation.isPending) && !isStreaming && !useAIStore.getState().currentStage && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="flex items-center gap-1.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
                <span className="ml-1 text-xs text-muted-foreground">
                  {mode === 'graph' && querySteps.length > 0
                    ? querySteps[querySteps.length - 1]
                    : 'Thinking…'}
                </span>
              </div>
            </div>
          )}
          {isStreaming && mode === 'graph' && querySteps.length > 0 && (
            <div className="text-[10px] text-muted-foreground/70">
              {querySteps[querySteps.length - 1]}
            </div>
          )}

          {/* Mention filter badges (graph mode) */}
          {mode === 'graph' && mentionFilterBadges.length > 0 && !isBusy && (
            <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
              <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">
                Filters applied
              </div>
              <div className="flex flex-wrap gap-1">
                {mentionFilterBadges.map((badge) => (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => handleMentionFilterBadgeClick(badge)}
                    className="rounded-sm"
                    title="Prefill filter token in input"
                  >
                    <Badge
                      variant="outline"
                      className="h-4 cursor-pointer px-1.5 text-[9px] hover:bg-muted"
                    >
                      {badge}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tokenUsage.total > 0 && !isBusy && (
            <div className="text-[10px] text-muted-foreground/50 pt-1">
              Tokens: {tokenUsage.total.toLocaleString()} (prompt:{' '}
              {tokenUsage.prompt.toLocaleString()}, completion:{' '}
              {tokenUsage.completion.toLocaleString()})
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-linear-to-b from-transparent to-muted/10 p-3 space-y-2">
        {/* Model tier + share controls */}
        <div className="flex items-center gap-2">
          <Select value={modelTier} onValueChange={(v) => setModelTier(v as ModelTier)}>
            <SelectTrigger className="h-6 w-auto rounded-full border-border/40 text-[11px] gap-1 pl-2.5 pr-2">
              <Zap className="h-3 w-3 shrink-0 text-primary" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="fast">Fast</SelectItem>
              <SelectItem value="powerful">Powerful</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {MODEL_TIER_LABELS[modelTier]}
            {modelTier === 'auto' && ' — routes per query'}
          </span>
          {mode === 'graph' && (
            <label className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
              <span>Shared</span>
              <Switch
                size="sm"
                checked={shareNextSlice}
                onCheckedChange={setShareNextSlice}
                aria-label="Make next graph slice link shareable"
              />
            </label>
          )}
        </div>

        {/* Textarea container */}
        <div className="rounded-2xl border border-border/50 bg-muted/20 transition-colors focus-within:border-primary/40 focus-within:bg-background/60">
          {/* Mention badges inside container */}
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pt-2.5">
              {mentions.map((mention) => (
                <Badge
                  key={`${mention.kind}:${mention.id}`}
                  variant="secondary"
                  className="gap-1 px-2 py-0.5 text-xs"
                >
                  <span>
                    #{mention.kind !== 'node' ? `${mention.kind}:` : ''}
                    {mention.label}
                  </span>
                  <button
                    type="button"
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      const next = mentions.filter(
                        (m) => !(m.kind === mention.kind && m.id === mention.id),
                      );
                      setMentions(next);
                    }}
                    aria-label={`Remove ${mention.label} mention`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 px-3 py-2">
            <MentionTextarea
              textareaRef={textareaRef}
              value={input}
              onChange={setInput}
              onMentionsChange={setMentions}
              onKeyDown={handleKeyDown}
              placeholder={
                mode === 'graph'
                  ? 'Ask about your codebase… (#auth, #module:api, #file:router, #error:null)'
                  : 'Ask anything… type # to mention a file, module, or function'
              }
              className="min-h-7 max-h-28 flex-1 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
              rows={1}
              disabled={isBusy}
            />
            <Button
              size="icon"
              onClick={() => void handleSend()}
              disabled={!input.trim() || isBusy || (mode === 'standalone' && !currentProjectId)}
              className="h-7 w-7 shrink-0 rounded-full"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
