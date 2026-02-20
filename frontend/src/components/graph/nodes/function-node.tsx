'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Braces, Box } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useNodeFlowState, getFlowStateClasses } from '@/hooks/use-node-flow-state';
import { NodeFlowOverlay } from './node-flow-overlay';

function FunctionNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const isClass = d.oirType === 'class';
  const Icon = isClass ? Box : Braces;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.function;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const { flowState, isReplaying, activeStep, depth } = useNodeFlowState(id);
  const flowClasses = getFlowStateClasses(flowState, isReplaying);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          relative rounded-lg border px-3 py-2 min-w-[140px] max-w-[260px] shadow-sm
          transition-all duration-200
          ${bgClass}
          ${!isReplaying && selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}
          ${!isReplaying && hasErrors ? 'ring-2 ring-red-500/60 shadow-red-500/20' : ''}
          ${flowClasses}
        `}
      >
        <NodeFlowOverlay flowState={flowState} isReplaying={isReplaying} activeStep={activeStep} depth={depth} />
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-sm font-mono font-medium truncate">{d.label}</span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        {d.signature && (
          <p className="text-[11px] font-mono text-muted-foreground truncate mt-1 pl-5">
            {d.signature}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
