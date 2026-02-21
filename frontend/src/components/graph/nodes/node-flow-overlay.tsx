'use client';

import { AlertCircle, CheckCircle2, Hash, Play } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { FlowStep } from '@/lib/oir/trace-flow';
import type { NodeFlowState } from '@/lib/stores/graph-store';

interface NodeFlowOverlayProps {
  flowState: NodeFlowState;
  isReplaying: boolean;
  activeStep: FlowStep | null;
  depth: number | null;
}

/**
 * Overlay badges rendered on top of graph nodes during trace replay.
 * Shows operation info for active nodes, checkmarks for completed, etc.
 */
function NodeFlowOverlayComponent({
  flowState,
  isReplaying,
  activeStep,
  depth,
}: NodeFlowOverlayProps) {
  if (!isReplaying || flowState === 'idle') return null;

  return (
    <>
      {/* Active node: operation + duration badge */}
      {flowState === 'active' && activeStep && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
          <Badge
            variant="secondary"
            className="bg-cyan-500/90 text-white text-[10px] px-2 py-0.5 font-mono shadow-md whitespace-nowrap"
          >
            <Play className="h-2.5 w-2.5 mr-1 fill-current" />
            {activeStep.operation}
            {activeStep.durationMs != null && (
              <span className="ml-1 opacity-80">{activeStep.durationMs}ms</span>
            )}
          </Badge>
          {depth != null && depth > 0 && (
            <Badge
              variant="outline"
              className="bg-background/90 text-[10px] px-1.5 py-0.5 font-mono border-cyan-500/40"
            >
              <Hash className="h-2.5 w-2.5 mr-0.5" />
              {depth}
            </Badge>
          )}
        </div>
      )}

      {/* Completed node: small checkmark */}
      {flowState === 'completed' && (
        <div className="absolute -top-2 -right-2 z-10">
          <div className="rounded-full bg-green-500 p-0.5 shadow-sm">
            <CheckCircle2 className="h-3 w-3 text-white" />
          </div>
        </div>
      )}

      {/* Error node: error indicator */}
      {flowState === 'error' && (
        <div className="absolute -top-2 -right-2 z-10 animate-bounce">
          <div className="rounded-full bg-red-500 p-0.5 shadow-sm">
            <AlertCircle className="h-3 w-3 text-white" />
          </div>
        </div>
      )}
    </>
  );
}

export const NodeFlowOverlay = memo(NodeFlowOverlayComponent);
