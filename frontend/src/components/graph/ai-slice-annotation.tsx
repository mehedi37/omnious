'use client';

import { memo, useCallback, useState } from 'react';
import { ArrowRight, Lightbulb, Maximize2, Minimize2, X } from 'lucide-react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { cn } from '@/lib/utils';

export interface SliceNarrative {
  summary: string;
  pattern: string | null;
  dataFlow: string | null;
  followUpQuestions: string[];
}

interface AISliceAnnotationProps {
  narrative: SliceNarrative;
  onFollowUp?: (question: string) => void;
  onDismiss?: () => void;
}

/**
 * Glass-morphism card on the graph canvas showing an AI-generated narrative
 * for the current graph slice. Dismissible + collapsible.
 */
function AISliceAnnotationInner({ narrative, onFollowUp, onDismiss }: AISliceAnnotationProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        'absolute bottom-4 left-4 z-40 max-w-sm',
        'rounded-xl border border-border/50 shadow-lg',
        'bg-background/80 backdrop-blur-md',
        'transition-all duration-300 ease-out',
        collapsed ? 'w-auto' : 'w-80',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-foreground/90">AI Narrative</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded p-1 hover:bg-muted/60 text-muted-foreground transition-colors cursor-pointer"
          >
            {collapsed ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded p-1 hover:bg-muted/60 text-muted-foreground transition-colors cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Summary */}
          <p className="text-xs text-foreground/85 leading-relaxed">
            {narrative.summary}
          </p>

          {/* Pattern badge */}
          {narrative.pattern && (
            <div className="flex items-center gap-1.5">
              <ArrowRight className="h-3 w-3 text-blue-400 shrink-0" />
              <span className="text-[10px] font-mono text-blue-400/90 bg-blue-500/10 rounded px-1.5 py-0.5">
                {narrative.pattern}
              </span>
            </div>
          )}

          {/* Data flow */}
          {narrative.dataFlow && (
            <p className="text-[10px] text-muted-foreground leading-relaxed italic">
              {narrative.dataFlow}
            </p>
          )}

          {/* Follow-up questions */}
          {narrative.followUpQuestions.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/20">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Follow up
              </span>
              {narrative.followUpQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onFollowUp?.(q)}
                  className="block w-full text-left text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted/40 rounded px-1.5 py-1 transition-colors cursor-pointer truncate"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const AISliceAnnotation = memo(AISliceAnnotationInner);
