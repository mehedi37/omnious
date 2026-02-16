'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileCode, Variable, Type } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';

const ICON_MAP = {
  module: FileCode,
  variable: Variable,
  type_def: Type,
} as const;

function ModuleNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const Icon = ICON_MAP[d.oirType as keyof typeof ICON_MAP] ?? FileCode;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.module;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const fileName = d.filePath?.split('/').pop() ?? d.label;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          rounded-lg border-2 px-4 py-3 min-w-[180px] max-w-[280px] shadow-sm
          transition-all duration-150
          ${bgClass}
          ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}
          ${hasErrors ? 'ring-2 ring-red-500/60 shadow-red-500/20' : ''}
        `}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        {d.filePath !== fileName && (
          <p className="text-[11px] text-muted-foreground truncate mt-1 pl-6">{d.filePath}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const ModuleNode = memo(ModuleNodeComponent, (prev, next) => {
  return prev.data === next.data && prev.selected === next.selected;
});
