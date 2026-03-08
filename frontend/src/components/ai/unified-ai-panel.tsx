'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Brain,
  Bug,
  ChevronDown,
  GitBranch,
  Loader2,
  Map,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AISessionType } from '@/lib/oir/types';
import { useAIStore } from '@/lib/stores/ai-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { AIMessage } from './ai-message';
import { AIQuickActions } from './ai-quick-actions';
import { MentionTextarea, type MentionEntry } from './mention-textarea';

// ─── Types ───────────────────────────────────────────────────

type ModelTier = 'auto' | 'fast' | 'powerful';

interface UnifiedAIPanelProps {
  /** 'graph' = inside graph page (uses callbacks). 'standalone' = AI sessions page (uses tRPC). */
  mode: 'graph' | 'standalone';
  /** Graph-mode callbacks (ignored in standalone mode) */
  onQuery?: (query: string, contextNodeIds?: string[], apiKeyId?: string, modelPreference?: ModelTier) => void;
  onShowErrors?: () => void;
  onLoadOverview?: () => void;
  isQuerying?: boolean;
  onClose?: () => void;
}

// ─── Quick actions for graph mode ────────────────────────────

const GRAPH_QUICK_ACTIONS = [
  { label: 'How does this project work?', icon: Brain, query: 'Explain the overall architecture and how this project works' },
  { label: 'Show me the errors', icon: Bug, query: '__errors__' },
  { label: 'Key dependencies', icon: GitBranch, query: 'Show the key dependencies and how the main modules connect' },
  { label: 'Back to overview', icon: Map, query: '__overview__' },
] as const;

const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  auto: 'Auto',
  fast: 'Fast',
  powerful: 'Powerful',
};

// ─── Component ───────────────────────────────────────────────

export function UnifiedAIPanel({
  mode,
  onQuery,
  onShowErrors,
  onLoadOverview,
  isQuerying = false,
  onClose,
}: UnifiedAIPanelProps) {
  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>('auto');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useAIStore((s) => s.messages);
  const isStreaming = useAIStore((s) => s.isStreaming);
  const tokenUsage = useAIStore((s) => s.tokenUsage);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  // Graph-mode extras
  const querySteps = useGraphStore((s) => s.querySteps);
  const nodeCount = useGraphStore((s) => s.nodes).length;
  const edgeCount = useGraphStore((s) => s.edges).length;

  // Standalone-mode tRPC mutations
  const createSessionMutation = trpc.ai.createSession.useMutation();
  const appendMessageMutation = trpc.ai.appendMessage.useMutation({
    onSuccess: () => {
      useAIStore.getState().setStreaming(false);
    },
    onError: (err) => {
      useAIStore.getState().addMessage({
        role: 'assistant',
        content: `Error: ${err.message}`,
      });
      useAIStore.getState().setStreaming(false);
    },
  });

  const isBusy = isQuerying || isStreaming || appendMessageMutation.isPending;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, querySteps.length]);

  // Listen for omnious:prefill-ai event (from context menu "Ask AI About This")
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

  // ── Send handler ─────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    setInput('');

    if (mode === 'graph') {
      const contextNodeIds = mentions.map((m) => m.nodeId);
      setMentions([]);
      onQuery?.(trimmed, contextNodeIds.length > 0 ? contextNodeIds : undefined, undefined, modelTier !== 'auto' ? modelTier : undefined);
    } else {
      // Standalone mode — tRPC mutations
      if (!currentProjectId) return;

      useAIStore.getState().addMessage({ role: 'user', content: trimmed });
      useAIStore.getState().setStreaming(true);

      const sessionId = activeSessionId ?? crypto.randomUUID();
      if (!activeSessionId) {
        useAIStore.getState().setActiveSession(sessionId, 'general');
        await createSessionMutation.mutateAsync({
          projectId: currentProjectId,
          type: 'general',
          modelPreference: modelTier !== 'auto' ? modelTier : undefined,
        });
      }

      appendMessageMutation.mutate({
        sessionId,
        messages: [{ role: 'user', content: trimmed }],
      });
    }
  }, [input, isBusy, mode, mentions, onQuery, currentProjectId, activeSessionId, modelTier, createSessionMutation, appendMessageMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
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
      useAIStore.getState().addMessage({ role: 'user', content: prompt });
      useAIStore.getState().setStreaming(true);

      await createSessionMutation.mutateAsync({
        projectId: currentProjectId,
        type: sessionType,
        modelPreference: modelTier !== 'auto' ? modelTier : undefined,
      });

      appendMessageMutation.mutate({
        sessionId,
        messages: [{ role: 'user', content: prompt }],
      });
    },
    [currentProjectId, modelTier, createSessionMutation, appendMessageMutation],
  );

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          {mode === 'graph' ? 'AI Graph Explorer' : 'AI Assistant'}
        </h3>
        {mode === 'graph' && nodeCount > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {nodeCount} nodes · {edgeCount} edges
          </span>
        )}
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
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="space-y-4 p-4">
          {/* Quick actions (shown when no messages) */}
          {messages.length === 0 && mode === 'graph' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask anything about your codebase. The AI will find relevant code and show it on the graph.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {GRAPH_QUICK_ACTIONS.map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    size="sm"
                    className="justify-start gap-2 h-auto py-2 px-3 text-left"
                    onClick={() => handleGraphQuickAction(action.query)}
                    disabled={isBusy}
                  >
                    <action.icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="text-xs">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.length === 0 && mode === 'standalone' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="rounded-full bg-primary/10 p-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">How can I help?</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Ask about your codebase, debug errors, explain data flows, or scan for security
                  issues.
                </p>
              </div>
              <AIQuickActions onAction={handleStandaloneQuickAction} />
            </div>
          )}

          {/* Chat messages */}
          {messages.map((msg, i) => (
            <AIMessage key={`${msg.role}-${i}`} message={msg} />
          ))}

          {/* Loading indicator */}
          {isBusy && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">
                {mode === 'graph' && querySteps.length > 0
                  ? querySteps[querySteps.length - 1]
                  : 'Analyzing codebase...'}
              </span>
            </div>
          )}

          {/* Token usage (after query) */}
          {tokenUsage.total > 0 && !isBusy && (
            <div className="text-[10px] text-muted-foreground/60 pt-1">
              Tokens: {tokenUsage.total.toLocaleString()} (prompt: {tokenUsage.prompt.toLocaleString()}, completion: {tokenUsage.completion.toLocaleString()})
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-3">
        {/* Model tier selector */}
        <div className="flex items-center gap-2 mb-2">
          <Select value={modelTier} onValueChange={(v) => setModelTier(v as ModelTier)}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <Zap className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="fast">Fast</SelectItem>
              <SelectItem value="powerful">Powerful</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[10px] text-muted-foreground">
            {modelTier === 'auto' && 'Routes to best model per query'}
            {modelTier === 'fast' && 'GPT-4o Mini / Haiku — quick answers'}
            {modelTier === 'powerful' && 'GPT-4o / Claude Sonnet — deep analysis'}
          </span>
        </div>

        <div className="flex gap-2">
          {mode === 'graph' ? (
            <MentionTextarea
              textareaRef={textareaRef}
              value={input}
              onChange={setInput}
              onMentionsChange={setMentions}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your codebase... (type # to mention a node)"
              className="min-h-10 max-h-30 resize-none text-sm"
              rows={1}
              disabled={isBusy}
            />
          ) : (
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your codebase…"
              className="min-h-[44px] max-h-[200px] resize-none text-sm"
              rows={1}
              disabled={isBusy}
            />
          )}
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isBusy || (mode === 'standalone' && !currentProjectId)}
            className="shrink-0"
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
