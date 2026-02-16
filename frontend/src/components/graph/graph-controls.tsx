'use client';

import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Flame,
  LayoutGrid,
  ArrowDownUp,
  ArrowLeftRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useGraphStore } from '@/lib/stores/graph-store';

export function GraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const isLayouting = useGraphStore((s) => s.isLayouting);

  const handleFitView = useCallback(() => fitView({ duration: 400 }), [fitView]);
  const handleZoomIn = useCallback(() => zoomIn({ duration: 200 }), [zoomIn]);
  const handleZoomOut = useCallback(() => zoomOut({ duration: 200 }), [zoomOut]);

  const handleToggleHeatmap = useCallback(() => {
    useGraphStore.getState().toggleHeatmap();
  }, []);

  const handleLayoutTB = useCallback(() => {
    useGraphStore.getState().setLayoutMode('layered-tb');
  }, []);

  const handleLayoutLR = useCallback(() => {
    useGraphStore.getState().setLayoutMode('layered-lr');
  }, []);

  return (
    <div className="flex items-center gap-1 border-b bg-background/95 backdrop-blur-sm px-3 py-1.5">
      {/* Zoom controls */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Zoom in</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Zoom out</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitView}>
            <Maximize className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Fit view</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Layout direction */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={layoutMode === 'layered-tb' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={handleLayoutTB}
            disabled={isLayouting}
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Top → Bottom</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={layoutMode === 'layered-lr' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={handleLayoutLR}
            disabled={isLayouting}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Left → Right</TooltipContent>
      </Tooltip>

      {isLayouting && (
        <span className="text-xs text-muted-foreground animate-pulse ml-1">Layouting…</span>
      )}

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Error heatmap toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={heatmapActive}
            onPressedChange={handleToggleHeatmap}
            className="h-7 px-2 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-600 dark:data-[state=on]:text-red-400"
          >
            <Flame className="h-4 w-4 mr-1" />
            <span className="text-xs">Errors</span>
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom">Toggle error heatmap</TooltipContent>
      </Tooltip>
    </div>
  );
}
