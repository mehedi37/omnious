'use client';

import { type NodeProps, NodeResizer } from '@xyflow/react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';

interface ModuleGroupData {
  label: string;
  color: string;
  nodeCount: number;
  [key: string]: unknown;
}

function ModuleGroupNodeInner({ id, data }: NodeProps) {
  const { label, color, nodeCount } = data as unknown as ModuleGroupData;
  const isCollapsed = useGraphStore((s) => s.collapsedGroups.has(id));
  const toggle = useCallback(() => {
    useGraphStore.getState().toggleGroupCollapse(id);
  }, [id]);

  return (
    <>
      {!isCollapsed && (
        <NodeResizer
          minWidth={200}
          minHeight={150}
          lineStyle={{ borderColor: color, opacity: 0.3 }}
          handleStyle={{ backgroundColor: color }}
        />
      )}
      <div
        className={`rounded-lg border-2 border-dashed p-3 ${isCollapsed ? 'h-auto w-auto' : 'h-full w-full'}`}
        style={{ borderColor: color, backgroundColor: `${color}10`, opacity: 0.75 }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            className="flex items-center justify-center rounded p-0.5 hover:bg-background/50 cursor-pointer"
          >
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" style={{ color }} />
              : <ChevronDown className="h-3.5 w-3.5" style={{ color }} />
            }
          </button>
          <Folder className="h-3.5 w-3.5" style={{ color }} />
          <span className="text-xs font-semibold" style={{ color }}>
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {nodeCount} node{nodeCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </>
  );
}

export const ModuleGroupNode = memo(ModuleGroupNodeInner);
