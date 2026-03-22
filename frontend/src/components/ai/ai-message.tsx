'use client';

import { Sparkles, User } from 'lucide-react';
import { memo, useCallback } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { AIMessage as AIChatMessage } from '@/lib/stores/ai-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

// Module-level constants — created once, never cause ReactMarkdown to remount
const REMARK_PLUGINS = [remarkGfm];

const USER_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 opacity-90 hover:opacity-100"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ className, children }) => {
    const isBlock = Boolean(className);
    if (!isBlock) {
      return (
        <code className="rounded bg-primary-foreground/20 px-1 py-0.5 font-mono text-xs">
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-x-auto rounded-md bg-primary-foreground/10 p-2.5">
        <code className="font-mono text-xs">{children}</code>
      </pre>
    );
  },
};

interface AIMessageProps {
  message: AIChatMessage;
  showCursor?: boolean;
}

export const AIMessage = memo(function AIMessage({ message, showCursor = false }: AIMessageProps) {
  const isUser = message.role === 'user';

  const focusAttachment = useCallback((attachmentId: string) => {
    const graphState = useGraphStore.getState();
    graphState.selectNode(attachmentId);
    graphState.setFocusMode(attachmentId);
    graphState.highlightConnectedEdges(attachmentId);
    useUIStore.getState().setDetailPanelOpen(true);
    window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
  }, []);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'}>
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={`
          max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed
          ${isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'}
        `}
      >
        {isUser ? (
          <div className="space-y-2 wrap-break-word">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={USER_MARKDOWN_COMPONENTS}>
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-2 wrap-break-word">
            <MarkdownRenderer content={message.content} className="text-sm leading-relaxed" />
            {showCursor && (
              <span
                aria-hidden
                className="inline-block align-middle h-[1em] w-0.5 bg-current opacity-80 animate-pulse"
              />
            )}
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.attachments.map((attachment) => {
              const isNode = attachment.kind === 'node';

              return (
                <Badge
                  key={`${attachment.kind}-${attachment.id}`}
                  variant="secondary"
                  className={isNode ? 'cursor-pointer' : ''}
                  onClick={isNode ? () => focusAttachment(attachment.id) : undefined}
                  title={isNode ? 'Focus on graph' : undefined}
                >
                  #{attachment.label}
                </Badge>
              );
            })}
          </div>
        )}

        {message.timestamp && (
          <p
            className={`text-[10px] mt-1 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}
          >
            {new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  );
});
