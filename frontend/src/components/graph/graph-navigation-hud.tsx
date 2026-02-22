'use client';

import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sigmaRef } from '@/lib/stores/graph-store';

/**
 * Floating HUD overlay showing zoom percentage and quick zoom controls.
 * Positioned in the bottom-right corner of the graph canvas.
 * Reads camera ratio from sigma and converts to zoom %.
 */
export function GraphNavigationHud() {
  const [zoomPercent, setZoomPercent] = useState(100);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const sigma = sigmaRef.current;
      if (sigma) {
        const ratio = sigma.getCamera().ratio;
        setZoomPercent(Math.round((1 / ratio) * 100));
      }
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleZoomIn = () => {
    sigmaRef.current?.getCamera().animatedZoom({ factor: 1.5, duration: 200 });
  };

  const handleZoomOut = () => {
    sigmaRef.current?.getCamera().animatedUnzoom({ factor: 1.5, duration: 200 });
  };

  const handleFit = () => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 400 });
  };

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
    </div>
  );
}
