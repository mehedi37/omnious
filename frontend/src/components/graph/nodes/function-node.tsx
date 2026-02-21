'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Box, Braces } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getFlowStateClasses, useNodeFlowState } from '@/hooks/use-node-flow-state';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { NodeFlowOverlay } from './node-flow-overlay';

function FunctionNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const isClass = d.oirType === 'class';
  const Icon = isClass ? Box : Braces;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.function;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const { flowState, isReplaying, activeStep, depth, isFocusDimmed } = useNodeFlowState(id);
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);
  const zoom = useGraphStore((s) => s.zoomLevel);

  // Minimal pill at service-level zoom
  if (zoom === 'service') {
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-muted-foreground !w-1.5 !h-1.5"
        />
        <div
          className={`rounded border px-1.5 py-0.5 text-[9px] font-mono truncate max-w-[100px] ${bgClass} ${flowClasses}`}
        >
          {d.label}
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-muted-foreground !w-1.5 !h-1.5"
        />
      </>
    );
  }

  // Module-level zoom: name only, no signature
  if (zoom === 'module') {
    return (
      <>
        <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
        <div
          className={`rounded-lg border px-2 py-1.5 min-w-[100px] max-w-[180px] ${bgClass} ${flowClasses}`}
        >
          <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-xs font-mono font-medium truncate">{d.label}</span>
          </div>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-muted-foreground !w-2 !h-2"
        />
      </>
    );
  }

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
        <NodeFlowOverlay
          flowState={flowState}
          isReplaying={isReplaying}
          activeStep={activeStep}
          depth={depth}
        />
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
          <span className="text-sm font-mono font-medium truncate">{d.label}</span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        {/* function zoom: show signature */}
        {d.signature && (
          <p className="text-[11px] font-mono text-muted-foreground truncate mt-1 pl-5">
            {d.signature}
          </p>
        )}
        {/* detail zoom: expanded doc + file path */}
        {zoom === 'detail' && d.filePath && (
          <p className="text-[10px] text-muted-foreground truncate mt-1 pl-5">{d.filePath}</p>
        )}
        {zoom === 'detail' && d.docComment && (
          <p className="text-[10px] text-muted-foreground/80 mt-1 pl-5 line-clamp-2">
            {d.docComment}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const FunctionNode = memo(FunctionNodeComponent);
