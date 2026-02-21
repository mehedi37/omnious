'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getFlowStateClasses, useNodeFlowState } from '@/hooks/use-node-flow-state';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { NodeFlowOverlay } from './node-flow-overlay';

function ErrorNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const errorCount = d.errorCount ?? 0;
  const { flowState, isReplaying, activeStep, depth, isFocusDimmed } = useNodeFlowState(id);
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);
  const zoom = useGraphStore((s) => s.zoomLevel);

  // Minimal pill at service-level zoom
  if (zoom === 'service') {
    return (
      <>
        <Handle type="target" position={Position.Top} className="!bg-red-500 !w-1.5 !h-1.5" />
        <div
          className={`rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-[9px] truncate max-w-[100px] ${flowClasses}`}
        >
          {d.label}
        </div>
        <Handle type="source" position={Position.Bottom} className="!bg-red-500 !w-1.5 !h-1.5" />
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-red-500 !w-2 !h-2" />
      <div
        className={`
          relative rounded-lg border-2 border-red-500/50 bg-red-500/10 px-4 py-3
          min-w-[160px] max-w-[280px]
          shadow-md shadow-red-500/20
          ${!isReplaying ? 'animate-pulse-slow' : ''}
          transition-all duration-200
          ${!isReplaying && selected ? 'ring-2 ring-red-500 ring-offset-2 ring-offset-background' : ''}
          ${flowClasses}
        `}
      >
        <NodeFlowOverlay
          flowState={flowState}
          isReplaying={isReplaying}
          activeStep={activeStep}
          depth={depth}
        />
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
          <span className="text-sm font-medium truncate">{d.label}</span>
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 font-bold">
            {errorCount}
          </Badge>
        </div>
        {zoom !== 'module' && d.errorSeverity && (
          <Badge
            variant="outline"
            className="mt-1.5 text-[10px] border-red-500/30 text-red-600 dark:text-red-400"
          >
            {d.errorSeverity}
          </Badge>
        )}
        {zoom !== 'module' && d.filePath && (
          <p className="text-[11px] text-red-600/70 dark:text-red-400/70 truncate mt-1">
            {d.filePath}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-red-500 !w-2 !h-2" />
    </>
  );
}

export const ErrorNode = memo(ErrorNodeComponent);
