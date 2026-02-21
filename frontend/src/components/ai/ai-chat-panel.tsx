'use client';

import { Bug, HelpCircle, Languages, Loader2, Send, Shield, Sparkles, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type { AISessionType } from '@/lib/oir/types';
import { useAIStore } from '@/lib/stores/ai-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { trpc } from '@/trpc/client';
import { AIMessage } from './ai-message';
import { AIQuickActions } from './ai-quick-actions';

export function AIChatPanel() {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messages = useAIStore((s) => s.messages);
  const isStreaming = useAIStore((s) => s.isStreaming);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId);

  const createSessionMutation = trpc.ai.createSession.useMutation();
  const appendMessageMutation = trpc.ai.appendMessage.useMutation({
    onSuccess: () => {
      // AI response would come from an external AI service;
      // for now we mark streaming as done after appending
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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || !currentProjectId) return;

    useAIStore.getState().addMessage({
      role: 'user',
      content: trimmed,
    });
    useAIStore.getState().setStreaming(true);
    setInput('');

    const sessionId = activeSessionId ?? crypto.randomUUID();
    if (!activeSessionId) {
      useAIStore.getState().setActiveSession(sessionId, 'general');
      await createSessionMutation.mutateAsync({
        projectId: currentProjectId,
        type: 'general',
      });
    }

    appendMessageMutation.mutate({
      sessionId,
      messages: [{ role: 'user', content: trimmed }],
    });
  };

  const handleQuickAction = async (sessionType: AISessionType, prompt: string) => {
    if (!currentProjectId) return;

    const sessionId = crypto.randomUUID();
    useAIStore.getState().setActiveSession(sessionId, sessionType);
    useAIStore.getState().addMessage({
      role: 'user',
      content: prompt,
    });
    useAIStore.getState().setStreaming(true);

    await createSessionMutation.mutateAsync({
      projectId: currentProjectId,
      type: sessionType,
    });

    appendMessageMutation.mutate({
      sessionId,
      messages: [{ role: 'user', content: prompt }],
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <ScrollArea className="flex-1 px-6" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 space-y-6">
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
            <AIQuickActions onAction={handleQuickAction} />
          </div>
        ) : (
          <div className="py-4 space-y-4">
            {messages.map((msg, i) => (
              <AIMessage key={i} message={msg} />
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input area */}
      <div className="border-t px-6 py-4">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your codebase…"
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || !currentProjectId}
            size="icon"
            className="h-[44px] w-[44px] shrink-0"
          >
            {isStreaming ? (
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
