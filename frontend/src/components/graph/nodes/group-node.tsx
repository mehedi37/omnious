'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { FolderOpen, Layers } from 'lucide-react';
import { memo, useContext } from 'react';
import { Badge } from '@/components/ui/badge';
import { ZoomLevelContext } from '../graph-canvas';

/** Data shape for group summary nodes */
export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  directory: string;
  childCount: number;
  childNodeIds: string[];
  /** Breakdown of OIR node types in this group, e.g. { route: 3, middleware: 2 } */
  typeBreakdown: Record<string, number>;
  /** The dominant (most frequent) OIR type, used for coloring */
  dominantType: string;
}

/** Color mapping for group nodes based on dominant child type */
const GROUP_BORDER_COLORS: Record<string, string> = {
  route: 'border-l-orange-500',
  middleware: 'border-l-amber-500',
  function: 'border-l-green-500',
  component: 'border-l-blue-500',
  module: 'border-l-slate-500',
  database_query: 'border-l-purple-500',
  class: 'border-l-indigo-500',
  event_emitter: 'border-l-cyan-500',
  event_listener: 'border-l-teal-500',
  external_api: 'border-l-pink-500',
  variable: 'border-l-slate-400',
  type_def: 'border-l-violet-500',
};

const GROUP_BG_COLORS: Record<string, string> = {
  route: 'bg-orange-500/5',
  middleware: 'bg-amber-500/5',
  function: 'bg-green-500/5',
  component: 'bg-blue-500/5',
  module: 'bg-slate-500/5',
  database_query: 'bg-purple-500/5',
  class: 'bg-indigo-500/5',
  event_emitter: 'bg-cyan-500/5',
  event_listener: 'bg-teal-500/5',
  external_api: 'bg-pink-500/5',
  variable: 'bg-slate-400/5',
  type_def: 'bg-violet-500/5',
};

function GroupNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as GroupNodeData;
  const zoom = useContext(ZoomLevelContext);
  const borderClass = GROUP_BORDER_COLORS[d.dominantType] ?? 'border-l-slate-500';
  const bgClass = GROUP_BG_COLORS[d.dominantType] ?? 'bg-slate-500/5';

  // Compact pill at service-level zoom
  if (zoom === 'service') {
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          className="bg-muted-foreground! w-1.5! h-1.5!"
        />
        <div
          className={`rounded-md border border-l-4 ${borderClass} ${bgClass} px-2.5 py-1 flex items-center gap-1.5`}
        >
          <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[10px] font-semibold truncate max-w-25">{d.label}</span>
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
            {d.childCount}
          </Badge>
        </div>
        <Handle
          type="source"
          position={Position.Bottom}
          className="bg-muted-foreground! w-1.5! h-1.5!"
        />
      </>
    );
  }

  // Standard view at module-level zoom
  const typeEntries = Object.entries(d.typeBreakdown).sort(([, a], [, b]) => b - a);

  return (
    <>
      <Handle type="target" position={Position.Top} className="bg-muted-foreground! w-2! h-2!" />
      <div
        className={`
          relative rounded-xl border-2 border-l-4 ${borderClass} ${bgClass}
          px-5 py-4 min-w-55 max-w-[320px] shadow-md
          transition-all duration-200
          ${selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div className="rounded-md bg-background/80 p-1.5">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-semibold truncate flex-1">{d.label}</span>
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {d.childCount}
          </Badge>
        </div>

        {/* Directory path */}
        <p className="text-[11px] text-muted-foreground truncate mb-2">{d.directory}</p>

        {/* Type breakdown */}
        <div className="flex flex-wrap gap-1">
          {typeEntries.slice(0, 4).map(([type, count]) => (
            <span
              key={type}
              className="text-[10px] bg-muted/60 rounded px-1.5 py-0.5 text-muted-foreground"
            >
              {type.replace('_', ' ')} ({count})
            </span>
          ))}
          {typeEntries.length > 4 && (
            <span className="text-[10px] text-muted-foreground/60">
              +{typeEntries.length - 4} more
            </span>
          )}
        </div>

        {/* Detail zoom: show all child types */}
        {zoom === 'detail' && (
          <p className="text-[10px] text-muted-foreground/70 mt-2">
            Zoom in to see individual nodes
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-muted-foreground! w-2! h-2!" />
    </>
  );
}

export const GroupNode = memo(GroupNodeComponent);
