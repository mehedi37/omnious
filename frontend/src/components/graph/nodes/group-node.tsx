'use no memo';
'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { FolderOpen, ChevronRight, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { RFNodeData } from '@/lib/stores/graph-store';
import { useNodeFlowState, getFlowStateClasses } from '@/hooks/use-node-flow-state';
import { useGraphStore } from '@/lib/stores/graph-store';
import { cn } from '@/lib/utils';

/**
 * Custom React Flow node for directory group nodes.
 * Shows directory name, child count, dominant type, type breakdown.
 * Uses React.memo (required for React Flow perf).
 */
function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RFNodeData;
  const { flowState, isReplaying, isFocusDimmed } = useNodeFlowState(id);
  const keyboardFocused = useGraphStore((s) => s.keyboardFocusedNodeId === id);
  const isNeighbor = useGraphStore((s) => s.neighborNodeIds.has(id));

  const dominantType = nodeData.dominantType ?? 'module';
  const bgClass = NODE_BG_CLASSES[dominantType as keyof typeof NODE_BG_CLASSES] ?? 'bg-muted border-border';
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);

  const typeBreakdown = nodeData.typeBreakdown ?? {};
  const topTypes = Object.entries(typeBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2.5 !h-2.5" />
      <div
        className={cn(
          'rounded-xl border-2 px-4 py-3 min-w-[180px] max-w-[280px] shadow-sm transition-all duration-200',
          bgClass,
          selected && 'ring-2 ring-amber-400 ring-offset-1 ring-offset-background shadow-md shadow-amber-400/20',
          !selected && isNeighbor && 'ring-2 ring-violet-400 ring-offset-1 ring-offset-background shadow-sm shadow-violet-400/20',
          keyboardFocused && 'ring-2 ring-blue-400 ring-offset-1 ring-offset-background',
          flowClasses,
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />
          <p className="text-sm font-semibold truncate">{nodeData.label}</p>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 ml-auto opacity-50" />
        </div>

        {/* Child count */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Layers className="h-3 w-3 shrink-0" />
          <span>{nodeData.childCount ?? 0} node{(nodeData.childCount ?? 0) !== 1 ? 's' : ''}</span>
        </div>

        {/* Type breakdown mini-bar */}
        {topTypes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {topTypes.map(([type, count]) => (
              <Badge
                key={type}
                variant="outline"
                className={cn(
                  'text-[8px] px-1 py-0 leading-tight',
                  NODE_BG_CLASSES[type as keyof typeof NODE_BG_CLASSES] ?? '',
                )}
              >
                {type.replace('_', ' ')} · {count}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2.5 !h-2.5" />
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
