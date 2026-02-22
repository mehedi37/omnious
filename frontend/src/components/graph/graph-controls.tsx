'use client';

import {
  ArrowDownUp,
  ArrowLeftRight,
  Crosshair,
  Filter,
  Flame,
  Keyboard,
  Layers,
  Maximize,
  RotateCcw,
  Search,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

export function GraphControls() {
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const layoutMode = useGraphStore((s) => s.layoutMode);
  const isLayouting = useGraphStore((s) => s.isLayouting);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const nodeCount = useGraphStore((s) => s.nodeCount);
  const viewMode = useGraphStore((s) => s.viewMode);
  const filtersOpen = useUIStore((s) => s.filtersOpen);
  const reactFlow = useReactFlow();

  function handleFitView() {
    reactFlow.fitView({ duration: 400 });
  }

  function handleZoomIn() {
    reactFlow.zoomIn({ duration: 200 });
  }

  function handleZoomOut() {
    reactFlow.zoomOut({ duration: 200 });
  }

  function handleResetLayout() {
    useGraphStore.getState().requestLayout();
  }

  function handleToggleViewMode() {
    const store = useGraphStore.getState();
    const next = store.viewMode === 'grouped' ? 'individual' : 'grouped';
    const currentFocusId = store.focusedNodeId;
    const graph = graphRef.current;

    store.setViewMode(next);
    setTimeout(() => {
      store.requestLayout();

      // If in focus mode, transition focus to the corresponding node in the new view
      if (currentFocusId && graph) {
        setTimeout(() => {
          if (next === 'grouped') {
            // All → Grouped: find the group containing the focused individual node
            const attrs = graph.hasNode(currentFocusId)
              ? graph.getNodeAttributes(currentFocusId)
              : null;
            let groupId: string | null = null;
            if (attrs?.filePath) {
              const dir = attrs.filePath.split('/').slice(0, -1).join('/') || '/';
              groupId = `group:${dir}`;
            }
            // Fallback: scan groups for one containing this node
            if (!groupId || !graph.hasNode(groupId)) {
              graph.forEachNode((id, a) => {
                if (a.isGroup && a.childNodeIds?.includes(currentFocusId)) {
                  groupId = id;
                }
              });
            }
            if (groupId && graph.hasNode(groupId)) {
              useGraphStore.getState().selectNode(groupId);
              useGraphStore.getState().setFocusMode(groupId);
              useUIStore.getState().setDetailPanelOpen(true);
            }
          } else {
            // Grouped → All: focus the first child of the focused group
            const groupAttrs = graph.hasNode(currentFocusId)
              ? graph.getNodeAttributes(currentFocusId)
              : null;
            const firstChild = groupAttrs?.childNodeIds?.[0];
            if (firstChild && graph.hasNode(firstChild)) {
              useGraphStore.getState().selectNode(firstChild);
              useGraphStore.getState().setFocusMode(firstChild);
              useUIStore.getState().setDetailPanelOpen(true);
            }
          }
        }, 150);
      }
    }, 50);
  }

  function handleToggleHeatmap() {
    useGraphStore.getState().toggleHeatmap();
  }

  function handleLayoutTB() {
    useGraphStore.getState().setLayoutMode('layered-tb');
  }

  function handleLayoutLR() {
    useGraphStore.getState().setLayoutMode('layered-lr');
  }

  function handleSearch() {
    useGraphStore.getState().setNodeSearchOpen(true);
  }

  function handleClearFocus() {
    useGraphStore.getState().clearFocusMode();
  }

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

      <div className="ml-auto flex items-center gap-1">
        {/* Filter toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={filtersOpen}
              onPressedChange={() => useUIStore.getState().toggleFilters()}
              className="h-7 w-7 p-0"
            >
              <Filter className="h-4 w-4" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle filters</TooltipContent>
        </Tooltip>

        {/* Keyboard shortcuts */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => useUIStore.getState().setKeyboardShortcutsOpen(true)}
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Keyboard shortcuts (?)</TooltipContent>
        </Tooltip>

        {/* Node count */}
        {nodeCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums ml-1">
            {nodeCount} nodes
          </span>
        )}
      </div>
    </div>
  );
}
