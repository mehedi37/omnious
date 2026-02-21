'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Layers, Route } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getFlowStateClasses, useNodeFlowState } from '@/hooks/use-node-flow-state';
import { HTTP_METHOD_COLORS, NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { NodeFlowOverlay } from './node-flow-overlay';

function RouteNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const isMiddleware = d.oirType === 'middleware';
  const Icon = isMiddleware ? Layers : Route;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.route;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const httpMethod = (d.metadata?.http_method as string) ?? null;
  const httpPath = (d.metadata?.http_path as string) ?? null;
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
          className={`rounded border px-1.5 py-0.5 text-[9px] truncate max-w-[120px] ${bgClass} ${flowClasses}`}
        >
          {httpMethod ? `${httpMethod} ${d.label}` : d.label}
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-muted-foreground !w-1.5 !h-1.5"
        />
      </>
    );
  }

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          relative rounded-lg border-2 px-4 py-3 min-w-[160px] max-w-[300px] shadow-sm
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
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
          {httpMethod && (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 font-mono font-bold ${HTTP_METHOD_COLORS[httpMethod] ?? ''}`}
            >
              {httpMethod}
            </Badge>
          )}
          <span className="text-sm font-medium truncate">{d.label}</span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        {httpPath && zoom !== 'module' && (
          <p className="text-[11px] font-mono text-muted-foreground truncate mt-1 pl-6">
            {httpPath}
          </p>
        )}
        {zoom === 'detail' && d.filePath && (
          <p className="text-[10px] text-muted-foreground truncate mt-1 pl-6">{d.filePath}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const RouteNode = memo(RouteNodeComponent);
