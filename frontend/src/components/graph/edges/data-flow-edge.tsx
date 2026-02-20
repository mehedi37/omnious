'use client';

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { GraphEdgeData } from '@/lib/oir/transforms';
import { EDGE_COLORS } from '@/lib/oir/constants';
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
}: EdgeProps) {
  const d = data as unknown as GraphEdgeData | undefined;
  const edgeType = d?.edgeType ?? 'calls';
  const strokeColor = EDGE_COLORS[edgeType] ?? EDGE_COLORS.calls;

  // Flow animation state
  const flowMode = useGraphStore((s) => s.flowMode);
  const isActive = useGraphStore((s) => s.activeEdgeIds.has(id));
  const inReplay = flowMode === 'replay';

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  // During replay: only active edges get the particle + glow
  const showParticle = inReplay ? isActive : true;
  const strokeWidth = inReplay
    ? isActive ? 4 : 1.5
    : selected ? 3 : 2;
  const opacity = inReplay
    ? isActive ? 1 : 0.2
    : 1;

  return (
    <>
      <defs>
        <linearGradient id={`gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.4 * opacity} />
          <stop offset="50%" stopColor={strokeColor} stopOpacity={opacity} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0.4 * opacity} />
        </linearGradient>
        {isActive && (
          <filter id={`glow-${id}`}>
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isActive ? strokeColor : `url(#gradient-${id})`,
          strokeWidth,
          opacity,
          filter: isActive ? `url(#glow-${id})` : undefined,
          transition: 'stroke-width 0.3s, opacity 0.3s',
        }}
      />
      {/* Animated particle along the path */}
      {showParticle && (
        <circle
          r={isActive ? 5 : 3}
          fill={strokeColor}
          opacity={isActive ? 1 : 0.6}
          filter={isActive ? `url(#glow-${id})` : undefined}
        >
          <animateMotion
            dur={isActive ? '1s' : '2s'}
            repeatCount={isActive ? '1' : 'indefinite'}
            path={edgePath}
            fill={isActive ? 'freeze' : undefined}
          />
        </circle>
      )}
    </>
  );
}

export const DataFlowEdge = memo(DataFlowEdgeComponent);
