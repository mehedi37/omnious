'use client';

import { Database, Globe, Sparkles, Search, Waypoints } from 'lucide-react';
import type { StreamStage } from '@/lib/stores/ai-store';
import { useAIStore } from '@/lib/stores/ai-store';

const STAGE_CONFIG: Record<StreamStage, { label: string; icon: typeof Sparkles }> = {
  embedding: { label: 'Understanding query…', icon: Database },
  searching: { label: 'Searching codebase…', icon: Search },
  traversing: { label: 'Traversing graph…', icon: Waypoints },
  analyzing: { label: 'Analyzing with AI…', icon: Sparkles },
  rendering: { label: 'Building graph…', icon: Globe },
};

/**
 * Stage-aware streaming indicator — shows the current pipeline stage
 * with an animated pill and icon. Replaces generic "Thinking…" text.
 */
export function AIStreamingIndicator() {
  const currentStage = useAIStore((s) => s.currentStage);
  const isStreaming = useAIStore((s) => s.isStreaming);

  if (!currentStage || !isStreaming) return null;

  const config = STAGE_CONFIG[currentStage];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Icon className="h-3 w-3 text-primary animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground animate-pulse">
          {config.label}
        </span>
        <div className="flex gap-0.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="inline-block h-1 w-1 rounded-full bg-primary/40 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
