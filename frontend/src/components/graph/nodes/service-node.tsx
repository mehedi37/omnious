'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Antenna, Globe, Radio } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { getFlowStateClasses, useNodeFlowState } from '@/hooks/use-node-flow-state';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { NodeFlowOverlay } from './node-flow-overlay';

const ICON_MAP = {
  external_api: Globe,
  event_emitter: Radio,
  event_listener: Antenna,
} as const;

function ServiceNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const Icon = ICON_MAP[d.oirType as keyof typeof ICON_MAP] ?? Globe;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.external_api;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const { flowState, isReplaying, activeStep, depth, isFocusDimmed } = useNodeFlowState(id);
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);
  const zoom = useGraphStore((s) => s.zoomLevel);

  // Minimal view at low zoom — just a compact pill
  if (zoom === 'service') {
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-muted-foreground !w-1.5 !h-1.5"
        />
        <div
          className={`rounded-md border px-2 py-1 text-[10px] font-semibold truncate max-w-[120px] ${bgClass} ${flowClasses}`}
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

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={`
          relative rounded-xl border-2 px-5 py-4 min-w-[200px] max-w-[300px] shadow-md
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
        {/* Module+ zoom: show file path */}
        {zoom !== 'module' && d.filePath && (
          <p className="text-[11px] text-muted-foreground truncate mt-1">{d.filePath}</p>
        )}
        {/* Detail zoom: show signature + doc comment */}
        {zoom === 'detail' && d.signature && (
          <pre className="text-[10px] font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1 mt-2 overflow-hidden whitespace-pre-wrap max-h-16">
            {d.signature}
          </pre>
        )}
        {zoom === 'detail' && d.docComment && (
          <p className="text-[10px] text-muted-foreground/80 mt-1 line-clamp-2">{d.docComment}</p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const ServiceNode = memo(ServiceNodeComponent);
