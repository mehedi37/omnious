'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Route, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES, HTTP_METHOD_COLORS } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';

function RouteNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const isMiddleware = d.oirType === 'middleware';
  const Icon = isMiddleware ? Layers : Route;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.route;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const httpMethod = (d.metadata?.http_method as string) ?? null;
  const httpPath = (d.metadata?.http_path as string) ?? null;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          rounded-lg border-2 px-4 py-3 min-w-[160px] max-w-[300px] shadow-sm
          transition-all duration-150
          ${bgClass}
          ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}
          ${hasErrors ? 'ring-2 ring-red-500/60 shadow-red-500/20' : ''}
        `}
      >
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
        {httpPath && (
          <p className="text-[11px] font-mono text-muted-foreground truncate mt-1 pl-6">
            {httpPath}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const RouteNode = memo(RouteNodeComponent, (prev, next) => {
  return prev.data === next.data && prev.selected === next.selected;
});
