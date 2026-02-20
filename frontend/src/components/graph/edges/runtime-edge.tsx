'use client';

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Runtime-discovered edge — a call path found during trace replay
 * that doesn't exist in the static import graph.
 * Visually distinct: dotted cyan line with glow when active.
 */
function RuntimeEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const isActive = useGraphStore((s) => s.activeEdgeIds.has(id));
  const strokeColor = 'oklch(0.7 0.2 195)'; // cyan

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
      {isActive && (
        <defs>
          <filter id={`runtime-glow-${id}`}>
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
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
          strokeWidth: isActive ? 3.5 : 2,
          strokeDasharray: '8 4',
          opacity: isActive ? 1 : 0.5,
          filter: isActive ? `url(#runtime-glow-${id})` : undefined,
          transition: 'stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {isActive && (
        <circle r={5} fill={strokeColor} filter={`url(#runtime-glow-${id})`}>
          <animateMotion dur="1s" repeatCount="1" path={edgePath} fill="freeze" />
        </circle>
      )}
    </>
  );
}

export const RuntimeEdge = memo(RuntimeEdgeComponent);
