'use client';

import { BaseEdge, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { memo } from 'react';
import { EDGE_COLORS } from '@/lib/oir/constants';
import type { GraphEdgeData } from '@/lib/oir/transforms';

function DependencyEdgeComponent({
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
  const edgeType = d?.edgeType ?? 'imports';
  const strokeColor = EDGE_COLORS[edgeType] ?? EDGE_COLORS.imports;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: strokeColor,
        strokeWidth: selected ? 2.5 : 1.5,
        strokeDasharray: '6 4',
        opacity: selected ? 1 : 0.6,
      }}
    />
  );
}

export const DependencyEdge = memo(DependencyEdgeComponent);
