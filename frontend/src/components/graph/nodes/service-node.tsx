'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Globe, Radio, Antenna } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';

const ICON_MAP = {
  external_api: Globe,
  event_emitter: Radio,
  event_listener: Antenna,
} as const;

function ServiceNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const Icon = ICON_MAP[d.oirType as keyof typeof ICON_MAP] ?? Globe;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.external_api;
  const hasErrors = (d.errorCount ?? 0) > 0;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          rounded-xl border-2 px-5 py-4 min-w-[200px] max-w-[300px] shadow-md
          transition-all duration-150
          ${bgClass}
          ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}
          ${hasErrors ? 'ring-2 ring-red-500/60 shadow-red-500/20' : ''}
        `}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-md bg-background/80 p-1.5">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {d.oirType.replace('_', ' ')}
          </span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        <p className="text-sm font-semibold truncate">{d.label}</p>
        {d.filePath && (
          <p className="text-[11px] text-muted-foreground truncate mt-1">{d.filePath}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const ServiceNode = memo(ServiceNodeComponent, (prev, next) => {
  return prev.data === next.data && prev.selected === next.selected;
});
