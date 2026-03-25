'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { ArrowRight, FileCode, Lock } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { NODE_BG_CLASSES_STRONG, NODE_TYPE_ICONS } from '@/lib/oir/constants';
import type { OIRNodeType } from '@/lib/oir/types';
import type { OmniousNodeData } from '@/lib/stores/graph-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useAIStore } from '@/lib/stores/ai-store';
import { useUIStore } from '@/lib/stores/ui-store';

function getIcon(oirType: OIRNodeType) {
  return NODE_TYPE_ICONS[oirType] ?? FileCode;
}

/** Show parent-dir/filename for index/main/app files, otherwise just the name */
function formatNodeLabel(name: string, filePath: string | null): string {
  if (!filePath) return name;
  if (/^(index|main|app|mod|lib)\b/i.test(name)) {
    const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
    }
  }
  return name;
}

/** Size-tier-specific styling */
const SIZE_CLASSES = {
  large:  'min-w-55 max-w-75 px-3.5 py-2.5',
  medium: 'min-w-45 max-w-70 px-3 py-2',
  small:  'min-w-38 max-w-60 px-2.5 py-1.5',
} as const;

const LABEL_SIZE_CLASSES = {
  large:  'text-sm',
  medium: 'text-sm',
  small:  'text-xs',
} as const;

/**
 * Custom React Flow node for Omnious code graph.
 * Displays: icon + name + type badge + file path.
 * Sized by graph importance (structural nodes / connections).
 * Shows entry-point marker, error badges, heatmap glow, and connection counts.
 */
function OmniousNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as OmniousNodeData;
  const oirType = nodeData.oirType;
  const bgClass = NODE_BG_CLASSES_STRONG[oirType] ?? 'bg-slate-500/20 border-slate-500/50';
  const Icon = getIcon(oirType);

  const sizeTier = nodeData.sizeTier ?? 'medium';
  const isSeed = nodeData.source === 'seed';
  const hasError = (nodeData.errorCount ?? 0) > 0;
  const isEntryPoint = nodeData.isEntryPoint ?? false;
  const connectionCount = nodeData.connectionCount ?? 0;

  const isPinned = useGraphStore((s) => s.pinnedNodeIds.has(id));
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const isActiveFlowNode = useGraphStore((s) => s.activeNodeId === id);
  const isInErrorFlow = useGraphStore((s) => s.errorFlowNodeIds.has(id));
  const errorFlowActive = useGraphStore((s) => s.errorFlowNodeIds.size > 0);
  const focusDepth = useGraphStore((s) => s.nodeDepthMap.get(id));
  const focusActive = useGraphStore((s) => s.focusedNodeId !== null);

  // Debounced hover tooltip
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => setShowTooltip(true), 400);
  }, []);
  const onMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowTooltip(false);
  }, []);

  // Compute heatmap class only when needed
  let heatmapClass = '';
  if (heatmapActive && hasError) {
    const count = nodeData.errorCount ?? 0;
    heatmapClass =
      count >= 10
        ? 'omnious-heatmap-critical'
        : count >= 5
          ? 'omnious-heatmap-high'
          : count >= 2
            ? 'omnious-heatmap-medium'
            : 'omnious-heatmap-low';
  }

  const pulseClass = (selected || isActiveFlowNode) && !heatmapClass ? 'omnious-node-pulse' : '';

  // Error flow: dim nodes not on the error path
  const errorFlowDim = errorFlowActive && !isInErrorFlow;
  // Error flow: highlight nodes on the red path
  const errorFlowHighlight = errorFlowActive && isInErrorFlow && hasError;

  // Focus depth: opacity decreases with distance from focused node
  const depthOpacity = focusActive && focusDepth !== undefined
    ? focusDepth === 0 ? 1 : focusDepth === 1 ? 0.85 : 0.6
    : undefined;
  const depthDim = focusActive && focusDepth === undefined;

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2! h-2! bg-muted-foreground/40!" />

      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`
          group relative rounded-lg border-2 shadow-sm transition-all duration-200
          ${SIZE_CLASSES[sizeTier]}
          ${bgClass}
          ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background shadow-md' : ''}
          ${isSeed ? 'border-l-4' : ''}
          ${hasError ? 'ring-1 ring-red-500/50' : ''}
          ${errorFlowHighlight ? 'ring-2 ring-red-500/70 shadow-red-500/30 shadow-lg' : ''}
          ${heatmapClass}
          ${pulseClass}
          hover:shadow-md hover:scale-[1.02]
        `}
        style={{
          opacity: errorFlowDim ? 0.3 : depthDim ? 0.25 : depthOpacity ?? undefined,
        }}
      >
        {/* Header: icon + name + entry-point marker */}
        <div className="flex items-center gap-2">
          {isEntryPoint && (
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          )}
          <Icon className="h-4 w-4 shrink-0 opacity-70" />
          <span className={`${LABEL_SIZE_CLASSES[sizeTier]} font-medium truncate leading-tight`}>
            {formatNodeLabel(nodeData.label, nodeData.filePath)}
          </span>
        </div>

        {/* Type badge + file path */}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="rounded-sm bg-background/50 px-1.5 py-0.5 font-mono uppercase tracking-wider">
            {oirType.replace(/_/g, ' ')}
          </span>
          {nodeData.filePath && (
            <span className="truncate opacity-60">
              {nodeData.filePath.split('/').pop()}
              {nodeData.lineStart != null ? `:${nodeData.lineStart}` : ''}
            </span>
          )}
        </div>

        {/* Signature (shown on hover/detail) */}
        {nodeData.signature && (
          <div className="mt-1 hidden group-hover:block text-[10px] font-mono text-muted-foreground/80 truncate">
            {nodeData.signature}
          </div>
        )}

        {/* Error badge — click to open AI error explain */}
        {hasError && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              useGraphStore.getState().selectNode(id);
              useAIStore.getState().setPrefillMessage(
                `Why is #${nodeData.label} throwing errors? Explain the ${nodeData.errorCount} error(s) on this node.`,
              );
              useUIStore.getState().setActiveDetailTab('ai');
            }}
            className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow cursor-pointer hover:bg-red-600 hover:scale-110 transition-all"
          >
            {nodeData.errorCount}
          </button>
        )}

        {/* Relevance indicator for seed nodes */}
        {nodeData.relevance != null && (
          <div className="absolute -top-1.5 -left-1.5 flex h-5 items-center rounded-full bg-primary/90 px-1.5 text-[9px] font-bold text-primary-foreground shadow">
            {Math.round(nodeData.relevance * 100)}%
          </div>
        )}

        {/* Connection count badge (shown when ≥3 connections) */}
        {connectionCount >= 3 && !hasError && (
          <div className="absolute -top-1.5 -right-1.5 flex h-5 items-center rounded-full bg-muted px-1.5 text-[9px] font-medium text-muted-foreground shadow">
            {connectionCount}
          </div>
        )}

        {/* Pin indicator */}
        {isPinned && (
          <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted/80 text-muted-foreground opacity-50">
            <Lock className="h-2.5 w-2.5" />
          </div>
        )}

        {/* Hover tooltip — shows rich detail after 400ms */}
        {showTooltip && !selected && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 pointer-events-none w-64">
            <div className="rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md text-xs space-y-1">
              <div className="font-medium truncate">{nodeData.label}</div>
              {nodeData.filePath && (
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {nodeData.filePath}
                  {nodeData.lineStart != null ? `:${nodeData.lineStart}` : ''}
                  {nodeData.lineEnd != null ? `-${nodeData.lineEnd}` : ''}
                </div>
              )}
              {nodeData.signature && (
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {nodeData.signature}
                </div>
              )}
              {nodeData.docComment && (
                <div className="text-[10px] text-muted-foreground line-clamp-2">
                  {nodeData.docComment}
                </div>
              )}
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <span>{oirType.replace(/_/g, ' ')}</span>
                {connectionCount > 0 && <span>&middot; {connectionCount} connections</span>}
                {hasError && <span className="text-red-400">&middot; {nodeData.errorCount} errors</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2! h-2! bg-muted-foreground/40!"
      />
    </>
  );
}

export const OmniousNode = memo(OmniousNodeComponent);
