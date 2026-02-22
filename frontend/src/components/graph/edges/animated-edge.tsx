'use no memo';
'use client';

import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { RFEdgeData } from '@/lib/stores/graph-store';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Custom animated edge for runtime/trace edges.
 * Shows a flowing particle animation along the path.
 * Uses React.memo (required for React Flow perf).
 */
function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  data,
}: EdgeProps) {
  const edgeData = data as RFEdgeData | undefined;
  const activeEdgeIds = useGraphStore((s) => s.activeEdgeIds);
  const isActive = activeEdgeIds.has(id);

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  const strokeColor = isActive ? 'oklch(0.7 0.2 195)' : (style?.stroke as string) ?? '#555';
  const strokeWidth = isActive ? 3 : (style?.strokeWidth as number) ?? 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
        }}
      />
      {/* Animated particle dot for active edges */}
      {(edgeData?.isRuntime || isActive) && (
        <>
          <circle r="3" fill={strokeColor} opacity={0.9}>
            <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
          </circle>
          <circle r="6" fill={strokeColor} opacity={0.2}>
            <animateMotion dur="1.5s" repeatCount="indefinite" path={edgePath} />
          </circle>
        </>
      )}
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
