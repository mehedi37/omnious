'use client';

import { Lock, Maximize, Minus, Plus, Unlock } from 'lucide-react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGraphStore } from '@/lib/stores/graph-store';

/**
 * Floating HUD overlay showing zoom percentage and quick zoom controls.
 * Positioned in the bottom-right corner of the graph canvas.
 * Reads zoom from React Flow viewport (event-driven, no polling).
 */
export function GraphNavigationHud() {
  const reactFlow = useReactFlow();
  const viewport = useViewport();
  const zoomPercent = Math.round(viewport.zoom * 100);
  const nodesLocked = useGraphStore((s) => s.nodesLocked);

  function handleZoomIn() {
    reactFlow.zoomIn({ duration: 200 });
  }

  function handleZoomOut() {
    reactFlow.zoomOut({ duration: 200 });
  }

  function handleFit() {
    reactFlow.fitView({ duration: 400 });
  }

  function handleToggleLock() {
    useGraphStore.getState().toggleNodesLocked();
  }

  return (
    <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1 rounded-lg border bg-background/80 backdrop-blur-sm px-1.5 py-1 shadow-sm">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomOut}>
            <Minus className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Zoom out (−)</TooltipContent>
      </Tooltip>

      <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground select-none">
        {zoomPercent}%
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomIn}>
            <Plus className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Zoom in (+)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleFit}>
            <Maximize className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Fit view (0)</TooltipContent>
      </Tooltip>

      <div className="w-px h-4 bg-border mx-0.5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={nodesLocked ? 'secondary' : 'ghost'}
            size="icon"
            className="h-6 w-6"
            onClick={handleToggleLock}
          >
            {nodesLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{nodesLocked ? 'Unlock positions' : 'Lock positions'}</TooltipContent>
      </Tooltip>
    </div>
  );
}
