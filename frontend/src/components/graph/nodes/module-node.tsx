'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { FileCode, Type, Variable } from 'lucide-react';
import { memo, useContext } from 'react';
import { Badge } from '@/components/ui/badge';
import { getFlowStateClasses, useNodeFlowState } from '@/hooks/use-node-flow-state';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { ZoomLevelContext } from '../graph-canvas';
import { NodeFlowOverlay } from './node-flow-overlay';

const ICON_MAP = {
  module: FileCode,
  variable: Variable,
  type_def: Type,
} as const;

function ModuleNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GraphNodeData;
  const Icon = ICON_MAP[d.oirType as keyof typeof ICON_MAP] ?? FileCode;
  const bgClass = NODE_BG_CLASSES[d.oirType] ?? NODE_BG_CLASSES.module;
  const hasErrors = (d.errorCount ?? 0) > 0;
  const fileName = d.filePath?.split('/').pop() ?? d.label;
  const { flowState, isReplaying, activeStep, depth, isFocusDimmed } = useNodeFlowState(id);
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);
  const zoom = useContext(ZoomLevelContext);

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
          className={`rounded border px-1.5 py-0.5 text-[9px] truncate max-w-[100px] ${bgClass} ${flowClasses}`}
        >
          {fileName}
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
          relative rounded-lg border-2 px-4 py-3 min-w-[180px] max-w-[280px] shadow-sm
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
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{fileName}</span>
          {hasErrors && (
            <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0">
              {d.errorCount}
            </Badge>
          )}
        </div>
        {/* Module+ zoom: show full file path */}
        {zoom !== 'module' && d.filePath !== fileName && (
          <p className="text-[11px] text-muted-foreground truncate mt-1 pl-6">{d.filePath}</p>
        )}
        {/* Detail zoom: show doc comment */}
        {zoom === 'detail' && d.docComment && (
          <p className="text-[10px] text-muted-foreground/80 mt-1 pl-6 line-clamp-2">
            {d.docComment}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const ModuleNode = memo(ModuleNodeComponent);
