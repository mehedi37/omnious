'use client';

import {
  ArrowDownUp,
  ArrowLeftRight,
  Crosshair,
  Flame,
  Layers,
  Maximize,
  RotateCcw,
  Search,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sigmaRef, useGraphStore } from '@/lib/stores/graph-store';

export function GraphControls() {
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const isLayouting = useGraphStore((s) => s.isLayouting);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const nodeCount = useGraphStore((s) => s.nodeCount);
  const viewMode = useGraphStore((s) => s.viewMode);

  const handleFitView = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 400 });
  }, []);

  const handleZoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ factor: 1.5, duration: 200 });
  }, []);

  const handleZoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ factor: 1.5, duration: 200 });
  }, []);

  const handleResetLayout = useCallback(() => {
    useGraphStore.getState().requestLayout();
  }, []);

  const handleToggleViewMode = useCallback(() => {
    const store = useGraphStore.getState();
    const next = store.viewMode === 'grouped' ? 'individual' : 'grouped';
    store.setViewMode(next);
    // Trigger layout for the new node set
    setTimeout(() => store.requestLayout(), 50);
  }, []);

  const handleToggleHeatmap = useCallback(() => {
    useGraphStore.getState().toggleHeatmap();
  }, []);

  const handleLayoutTB = useCallback(() => {
    useGraphStore.getState().setLayoutMode('layered-tb');
  }, []);

  const handleLayoutLR = useCallback(() => {
    useGraphStore.getState().setLayoutMode('layered-lr');
  }, []);

  const handleSearch = useCallback(() => {
    useGraphStore.getState().setNodeSearchOpen(true);
  }, []);

  const handleClearFocus = useCallback(() => {
    useGraphStore.getState().clearFocusMode();
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

      {/* Reset Layout */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleResetLayout}
            disabled={isLayouting}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Reset layout</TooltipContent>
      </Tooltip>

      {/* View mode: grouped ↔ individual */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={viewMode === 'grouped' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 gap-1"
            onClick={handleToggleViewMode}
            disabled={isLayouting}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="text-xs">{viewMode === 'grouped' ? 'Grouped' : 'All'}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {viewMode === 'grouped' ? 'Show all individual nodes' : 'Show grouped by directory'}
        </TooltipContent>
      </Tooltip>

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

      <Separator orientation="vertical" className="mx-1 h-5" />

      {/* Node search */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Search nodes (Ctrl+F)</TooltipContent>
      </Tooltip>

      {/* Focus mode indicator + clear */}
      {focusedNodeId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2 gap-1 text-xs bg-primary/10 text-primary"
              onClick={handleClearFocus}
            >
              <Crosshair className="h-3.5 w-3.5" />
              Focus
              <XCircle className="h-3 w-3 ml-0.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Exit focus mode (Esc)</TooltipContent>
        </Tooltip>
      )}

      {/* Node count */}
      <div className="ml-auto text-xs text-muted-foreground tabular-nums">
        {nodeCount > 0 && <span>{nodeCount} nodes</span>}
      </div>
    </div>
  );
}
