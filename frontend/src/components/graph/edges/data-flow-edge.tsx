'use client';

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { GraphEdgeData } from '@/lib/oir/transforms';
import { EDGE_COLORS } from '@/lib/oir/constants';

function DataFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps) {
  const d = data as unknown as GraphEdgeData | undefined;
  const edgeType = d?.edgeType ?? 'calls';
  const strokeColor = EDGE_COLORS[edgeType] ?? EDGE_COLORS.calls;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  return (
    <>
      <defs>
        <linearGradient id={`gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.4} />
          <stop offset="50%" stopColor={strokeColor} stopOpacity={1} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0.4} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: `url(#gradient-${id})`,
          strokeWidth: selected ? 3 : 2,
          filter: selected ? `drop-shadow(0 0 4px ${strokeColor})` : undefined,
        }}
      />
      {/* Animated particle along the path */}
      <circle r={3} fill={strokeColor}>
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
}

export const DataFlowEdge = memo(DataFlowEdgeComponent);
