'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_BG_CLASSES_STRONG, NODE_ICONS } from '@/lib/oir/constants';
import { useGraphStore } from '@/lib/stores/graph-store';
import type { OmniousNodeData } from '@/lib/stores/graph-store';
import type { OIRNodeType } from '@/lib/oir/types';
import {
  Braces, Component, Route, Database, FileCode, Box,
  Layers, Radio, Antenna, Globe, Variable, Type,
  Cuboid, List, FileInput, FolderTree, Puzzle, Shield, Package,
  Lock,
} from 'lucide-react';

// Icon map — matches NODE_ICONS Lucide names to components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Braces, Component, Route, Database, FileCode, Box,
  Layers, Radio, Antenna, Globe, Variable, Type,
  Cuboid, List, FileInput, FolderTree, Puzzle, Shield, Package,
};

function getIcon(oirType: OIRNodeType) {
  const iconName = NODE_ICONS[oirType] ?? 'FileCode';
  return ICON_MAP[iconName] ?? FileCode;
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

/**
 * Custom React Flow node for Omnious code graph.
 * Displays: icon + name + type badge + file path.
 * Styled with the OIR node type color scheme.
 */
function OmniousNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as OmniousNodeData;
  const oirType = nodeData.oirType;
  const bgClass = NODE_BG_CLASSES_STRONG[oirType] ?? 'bg-slate-500/20 border-slate-500/50';
  const Icon = getIcon(oirType);

  const isSeed = nodeData.source === 'seed';
  const hasError = (nodeData.errorCount ?? 0) > 0;
  const isPinned = useGraphStore((s) => s.pinnedNodeIds.has(id));
  const heatmapActive = useGraphStore((s) => s.heatmapActive);

  // Heatmap glow class based on error severity/count
  const heatmapClass = heatmapActive && hasError
    ? (nodeData.errorCount ?? 0) >= 10
      ? 'omnious-heatmap-critical'
      : (nodeData.errorCount ?? 0) >= 5
        ? 'omnious-heatmap-high'
        : (nodeData.errorCount ?? 0) >= 2
          ? 'omnious-heatmap-medium'
          : 'omnious-heatmap-low'
    : '';

  return (
    <>
      <Handle type="target" position={Position.Top} className="w-2! h-2! bg-muted-foreground/40!" />

      <div
        className={`
          group relative rounded-lg border-2 px-3 py-2 shadow-sm transition-all duration-200
          min-w-45 max-w-70
          ${bgClass}
          ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background shadow-md' : ''}
          ${isSeed ? 'border-l-4' : ''}
          ${hasError ? 'ring-1 ring-red-500/50' : ''}
          ${heatmapClass}
          hover:shadow-md hover:scale-[1.02]
        `}
      >
        {/* Header: icon + name */}
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 opacity-70" />
          <span className="text-sm font-medium truncate leading-tight">
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

        {/* Error badge */}
        {hasError && (
          <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow">
            {nodeData.errorCount}
          </div>
        )}

        {/* Relevance indicator for seed nodes */}
        {nodeData.relevance != null && (
          <div className="absolute -top-1.5 -left-1.5 flex h-5 items-center rounded-full bg-primary/90 px-1.5 text-[9px] font-bold text-primary-foreground shadow">
            {Math.round(nodeData.relevance * 100)}%
          </div>
        )}

        {/* Pin indicator */}
        {isPinned && (
          <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted/80 text-muted-foreground opacity-50">
            <Lock className="h-2.5 w-2.5" />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-2! h-2! bg-muted-foreground/40!" />
    </>
  );
}

export const OmniousNode = memo(OmniousNodeComponent);
