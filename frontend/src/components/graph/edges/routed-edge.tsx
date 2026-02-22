'use no memo';
'use client';

import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import type { RFEdgeData } from '@/lib/stores/graph-store';

const CORNER_RADIUS = 8;

/**
 * Build an SVG path string from an array of points with rounded corners.
 * Uses quadratic bezier curves at each bend for smooth, Supabase-style routing.
 */
function buildRoutedPath(points: { x: number; y: number }[]): string | null {
  if (points.length < 2) return null;
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  let d = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const A = points[i - 1];
    const B = points[i];
    const C = points[i + 1];
    const dx1 = B.x - A.x;
    const dy1 = B.y - A.y;
    const dx2 = C.x - B.x;
    const dy2 = C.y - B.y;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 === 0 || len2 === 0) continue;
    const r = Math.min(CORNER_RADIUS, len1 / 2, len2 / 2);
    // Point approaching the bend
    const px = B.x - (dx1 / len1) * r;
    const py = B.y - (dy1 / len1) * r;
    // Point leaving the bend
    const qx = B.x + (dx2 / len2) * r;
    const qy = B.y + (dy2 / len2) * r;
    d += ` L ${px},${py} Q ${B.x},${B.y} ${qx},${qy}`;
  }

  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * Custom edge that uses ELK-computed route points for node-avoiding paths.
 * Route data is embedded in the edge's `data.routePoints` prop (no store subscription).
 * Falls back to a straight line if no route data is available.
 */
function RoutedEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const elkPoints = (data as RFEdgeData | undefined)?.routePoints;

  const edgePath = useMemo(() => {
    if (elkPoints && elkPoints.length >= 2) {
      // Use ELK-computed bend points — snap start/end to RF handle positions
      const routedPoints = [
        { x: sourceX, y: sourceY },
        ...elkPoints.slice(1, -1), // keep only interior bend points
        { x: targetX, y: targetY },
      ];
      return buildRoutedPath(routedPoints) ?? '';
    }
    // Cheap straight-line fallback (much faster than getSmoothStepPath)
    const [straightPath] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
    });
    return straightPath;
  }, [sourceX, sourceY, targetX, targetY, elkPoints]);

  // Respect dynamic stroke/width/opacity set by highlightConnectedEdges
  const strokeColor = (style?.stroke as string) ?? 'currentColor';
  const strokeWidth = (style?.strokeWidth as number) ?? 1.2;
  const opacity = (style?.opacity as number) ?? 0.45;

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        ...style,
        stroke: strokeColor,
        strokeWidth,
        opacity,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }}
    />
  );
}

export const RoutedEdge = memo(RoutedEdgeComponent);
