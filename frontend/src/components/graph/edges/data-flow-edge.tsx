'use client';

import { BaseEdge, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EDGE_COLORS } from '@/lib/oir/constants';
import type { GraphEdgeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';

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
  style,
}: EdgeProps) {
  const d = data as unknown as GraphEdgeData | undefined;
  const edgeType = d?.edgeType ?? 'calls';
  const strokeColor = EDGE_COLORS[edgeType] ?? EDGE_COLORS.calls;

  // Flow animation state — single combined subscription instead of 2 per edge
  const { inReplay, isActive } = useGraphStore(
    useShallow((s) => ({
      inReplay: s.flowMode === 'replay',
      isActive: s.activeEdgeIds.has(id),
    })),
  );

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  // During replay: active edges get particle + glow, others dim
  // Outside replay: simple static colored edge (NO continuous animation)
  const strokeWidth = inReplay ? (isActive ? 4 : 1.5) : selected ? 2.5 : 1.5;
  const opacity = inReplay ? (isActive ? 1 : 0.15) : ((style?.opacity as number) ?? 0.7);

  return (
    <>
      {/* Only add per-edge defs during active replay */}
      {inReplay && isActive && (
        <defs>
          <filter id={`glow-${id}`}>
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          opacity,
          filter: inReplay && isActive ? `url(#glow-${id})` : undefined,
          transition: 'stroke-width 0.3s, opacity 0.3s',
          ...style,
        }}
      />
      {/* Only render animated particle during active replay */}
      {inReplay && isActive && (
        <circle r={5} fill={strokeColor} filter={`url(#glow-${id})`}>
          <animateMotion dur="1s" repeatCount="1" path={edgePath} fill="freeze" />
        </circle>
      )}
    </>
  );
}

export const DataFlowEdge = memo(DataFlowEdgeComponent);
