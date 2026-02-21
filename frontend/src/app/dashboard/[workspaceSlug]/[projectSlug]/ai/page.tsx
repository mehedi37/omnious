'use client';

import { AIChatPanel } from '@/components/ai/ai-chat-panel';
import { HydrateClient } from '@/trpc/server';

export default function AIPage() {
  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">AI Assistant</h2>
          <p className="text-sm text-muted-foreground">
            Ask questions about your codebase, debug issues, or explore flows
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <AIChatPanel />
      </div>
    </div>
  );
}
