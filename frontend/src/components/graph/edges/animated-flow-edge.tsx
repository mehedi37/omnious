'use client';

import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { EDGE_COLORS } from '@/lib/oir/constants';
import type { OIREdgeType } from '@/lib/oir/types';
import type { OmniousEdgeData } from '@/lib/stores/graph-store';
import { useGraphStore } from '@/lib/stores/graph-store';

/** Stroke width by edge type — primary dataflow edges are thicker */
const EDGE_STROKE_WIDTH: Partial<Record<OIREdgeType | 'runtime_call', number>> = {
  calls: 2,
  renders: 2,
  routes_to: 1.8,
  queries: 1.8,
  runtime_call: 2,
  imports: 1.2,
  exports: 1.2,
};

/** Dash pattern for structural/inheritance edges */
const DASHED_EDGE_TYPES: ReadonlySet<string> = new Set([
  'imports', 'exports', 'extends', 'implements',
]);

/**
 * Custom edge for the Omnious code graph.
 * Uses OKLCH colors from the OIR edge type palette.
 * Stroke width varies by type. Arrowheads show direction.
 * Animated dot only shown during flow replay mode (via data.flowReplay).
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
  const flowReplay = edgeData?.flowReplay ?? false;

  const hovered = useGraphStore((s) => s.hoveredEdgeId === id);
  const setHoveredEdgeId = useGraphStore((s) => s.setHoveredEdgeId);

  const errorFlowActive = useGraphStore((s) => s.errorFlowEdgeIds.size > 0);
  const isInErrorFlow = useGraphStore((s) => s.errorFlowEdgeIds.has(id));
  const errorFlowDim = errorFlowActive && !isInErrorFlow;

  const effectiveColor = errorFlowActive && isInErrorFlow
    ? 'oklch(0.65 0.25 25)' // red for error path
    : isRuntime
      ? 'oklch(0.7 0.2 195)'
      : (EDGE_COLORS[edgeType as OIREdgeType] ?? 'oklch(0.6 0.03 260)');

  const baseStroke = EDGE_STROKE_WIDTH[edgeType as OIREdgeType | 'runtime_call'] ?? 1.5;
  const isDashed = DASHED_EDGE_TYPES.has(edgeType);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });

  const markerId = `omnious-arrow-${id}`;

  return (
    <>
      {/* Arrow marker definition */}
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 Z" fill={effectiveColor} opacity={selected || hovered ? 1 : 0.7} />
        </marker>
      </defs>

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: effectiveColor,
          strokeWidth: isInErrorFlow ? baseStroke + 1 : selected ? baseStroke + 1 : hovered ? baseStroke + 0.5 : baseStroke,
          opacity: errorFlowDim ? 0.15 : selected ? 1 : hovered ? 0.9 : 0.75,
          strokeDasharray: isDashed ? '6 3' : undefined,
        }}
        markerEnd={`url(#${markerId})`}
        onMouseEnter={() => setHoveredEdgeId(id)}
        onMouseLeave={() => setHoveredEdgeId(null)}
      />

      {/* Animated dot only during flow replay — avoids constant GPU repaints */}
      {flowReplay && (
        <circle r="3" fill={effectiveColor} opacity={0.8}>
          <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}

      {/* Edge type label — shown on hover or select */}
      {(selected || hovered) && (
        <foreignObject
          x={labelX - 40}
          y={labelY - 14}
          width={80}
          height={20}
          className="pointer-events-none"
        >
          <div className="flex items-center justify-center">
            <span className="rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground shadow-sm backdrop-blur-sm">
              {edgeType.replace(/_/g, ' ')}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const AnimatedFlowEdge = memo(AnimatedFlowEdgeComponent);
