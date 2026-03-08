'use client';

import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { EDGE_COLORS } from '@/lib/oir/constants';
import type { OmniousEdgeData } from '@/lib/stores/graph-store';
import type { OIREdgeType } from '@/lib/oir/types';

/**
 * Custom animated edge for the Omnious code graph.
 * Uses OKLCH colors from the OIR edge type palette.
 * Animates flow direction with a CSS dash animation.
 */
function AnimatedFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as unknown as OmniousEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? 'calls';
  const isRuntime = edgeData?.isRuntime ?? false;

  const color = isRuntime
    ? 'oklch(0.7 0.2 195)' // cyan for runtime edges
    : EDGE_COLORS[edgeType as OIREdgeType] ?? 'oklch(0.6 0.03 260)';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: color,
          strokeWidth: selected ? 2.5 : isRuntime ? 2 : 1.5,
          opacity: selected ? 1 : 0.6,
        }}
      />

      {/* Animated dot for flow direction */}
      <circle r="3" fill={color} opacity={0.8}>
        <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* Edge type label */}
      {selected && (
        <text
          x={labelX}
          y={labelY - 8}
          textAnchor="middle"
          className="fill-muted-foreground text-[9px] font-mono"
        >
          {edgeType.replace(/_/g, ' ')}
        </text>
      )}
    </>
  );
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeComponent);
