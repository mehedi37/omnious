'use no memo';
'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useContext } from 'react';
import {
  Braces,
  Component,
  Route,
  Database,
  FileCode,
  Box,
  Layers,
  Radio,
  Antenna,
  Globe,
  Variable,
  Type,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES, NODE_BG_CLASSES_STRONG, NODE_ACCENT_BORDER } from '@/lib/oir/constants';
import type { RFNodeData } from '@/lib/stores/graph-store';
import { useNodeFlowState, getFlowStateClasses } from '@/hooks/use-node-flow-state';
import { useGraphStore } from '@/lib/stores/graph-store';
import { ZoomLevelContext } from '../graph-canvas';
import { cn } from '@/lib/utils';

/** Map OIR node type → Lucide icon component */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  function: Braces,
  component: Component,
  route: Route,
  database_query: Database,
  module: FileCode,
  class: Box,
  middleware: Layers,
  event_emitter: Radio,
  event_listener: Antenna,
  external_api: Globe,
  variable: Variable,
  type_def: Type,
};

/**
 * Custom React Flow node for individual code nodes.
 * Renders themed card with icon, name, type badge, error indicator.
 * Uses React.memo (required for React Flow perf, even with React Compiler).
 */
function CodeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RFNodeData;
  const { flowState, isReplaying, isFocusDimmed } = useNodeFlowState(id);
  const keyboardFocused = useGraphStore((s) => s.keyboardFocusedNodeId === id);
  const isNeighbor = useGraphStore((s) => s.neighborNodeIds.has(id));
  const zoomLevel = useContext(ZoomLevelContext);

  const oirType = nodeData.oirType ?? 'module';
  const Icon = ICON_MAP[oirType] ?? FileCode;
  const isDetail = zoomLevel === 'detail';
  const bgClass = isDetail
    ? (NODE_BG_CLASSES_STRONG[oirType as keyof typeof NODE_BG_CLASSES_STRONG] ?? 'bg-muted border-border')
    : (NODE_BG_CLASSES[oirType as keyof typeof NODE_BG_CLASSES] ?? 'bg-muted border-border');
  const accentBorder = isDetail
    ? (NODE_ACCENT_BORDER[oirType as keyof typeof NODE_ACCENT_BORDER] ?? '')
    : '';
  const flowClasses = getFlowStateClasses(flowState, isReplaying, isFocusDimmed);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
      <div
        className={cn(
          'rounded-lg border px-3 py-2 min-w-[140px] shadow-sm transition-all duration-200',
          isDetail ? 'max-w-[300px] border-l-4' : 'max-w-[240px]',
          bgClass,
          accentBorder,
          selected && 'ring-2 ring-amber-400 ring-offset-1 ring-offset-background shadow-md shadow-amber-400/20',
          !selected && isNeighbor && 'ring-2 ring-violet-400 ring-offset-1 ring-offset-background shadow-sm shadow-violet-400/20',
          keyboardFocused && 'ring-2 ring-blue-400 ring-offset-1 ring-offset-background',
          nodeData.errorCount != null && nodeData.errorCount > 0 && 'animate-pulse-slow border-red-500/40',
          flowClasses,
        )}
      >
        {/* Header: icon + type badge */}
        <div className="flex items-center gap-1.5 mb-1">
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 leading-tight opacity-80"
          >
            {oirType.replace('_', ' ')}
          </Badge>
          {nodeData.errorCount != null && nodeData.errorCount > 0 && (
            <div className="ml-auto flex items-center gap-0.5 text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span className="text-[10px] font-medium">{nodeData.errorCount}</span>
            </div>
          )}
        </div>

        {/* Name */}
        <p className="text-sm font-medium truncate leading-snug">{nodeData.label}</p>

        {/* Detail zoom: show expanded info */}
        {isDetail && nodeData.signature && (
          <pre className="text-[10px] font-mono text-muted-foreground bg-background/50 rounded px-1.5 py-1 mt-1.5 overflow-x-auto whitespace-pre-wrap leading-tight max-h-16">
            {nodeData.signature}
          </pre>
        )}

        {/* File path + line range */}
        {nodeData.filePath && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 opacity-70">
            {nodeData.filePath}
            {isDetail && nodeData.lineStart && (
              <span className="ml-1">:{nodeData.lineStart}{nodeData.lineEnd ? `–${nodeData.lineEnd}` : ''}</span>
            )}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
    </>
  );
}

export const CodeNode = memo(CodeNodeComponent);
