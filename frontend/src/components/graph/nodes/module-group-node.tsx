'use client';

import { memo } from 'react';
import { type NodeProps, NodeResizer } from '@xyflow/react';

interface ModuleGroupData {
  label: string;
  color: string;
  nodeCount: number;
  [key: string]: unknown;
}

function ModuleGroupNodeInner({ data }: NodeProps) {
  const { label, color, nodeCount } = data as unknown as ModuleGroupData;

  return (
    <>
      <NodeResizer
        minWidth={200}
        minHeight={150}
        lineStyle={{ borderColor: color, opacity: 0.3 }}
        handleStyle={{ backgroundColor: color }}
      />
      <div
        className="h-full w-full rounded-lg border-2 border-dashed p-3 opacity-60"
        style={{ borderColor: color, backgroundColor: `${color}10` }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs font-semibold" style={{ color }}>
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {nodeCount} nodes
          </span>
        </div>
      </div>
    </>
  );
}

export const ModuleGroupNode = memo(ModuleGroupNodeInner);
