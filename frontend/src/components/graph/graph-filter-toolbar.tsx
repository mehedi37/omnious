'use client';

import {
  AlertCircle,
  AlertTriangle,
  Crosshair,
  Filter,
  Flame,
  Info,
  PanelLeft,
  PanelRight,
  X,
} from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useGraphStore } from '@/lib/stores/graph-store';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Severity = 'error' | 'warning' | 'info';

interface FilterChipProps {
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  colorClass: string;
  onToggle: () => void;
}

interface GraphFilterToolbarProps {
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}

// ─── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({ icon: Icon, label, active, colorClass, onToggle }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
        'hover:shadow-sm',
        active
          ? `${colorClass} border-current/30 shadow-sm`
          : 'border-border text-muted-foreground opacity-50 hover:opacity-75',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

// ─── Toolbar component ───────────────────────────────────────────────────────

/**
 * Horizontal filter bar for error severity + heatmap toggle.
 * Renders above the graph canvas. On desktop, also shows panel toggle buttons.
 */
export function GraphFilterToolbar({
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeft,
  onToggleRight,
}: GraphFilterToolbarProps) {
  const severityFilters = useGraphStore((s) => s.severityFilters);
  const heatmapActive = useGraphStore((s) => s.heatmapActive);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const nodes = useGraphStore((s) => s.nodes);

  const focusedNodeName = focusedNodeId
    ? (nodes.find((n) => n.id === focusedNodeId)?.data.label ?? focusedNodeId)
    : null;

  const toggleSeverity = useCallback((severity: Severity) => {
    useGraphStore.getState().toggleSeverityFilter(severity);
  }, []);

  const toggleHeatmap = useCallback(() => {
    useGraphStore.getState().toggleHeatmap();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b bg-background/95 backdrop-blur-sm overflow-x-auto">
      <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1 shrink-0" />

      <FilterChip
        severity="error"
        icon={AlertCircle}
        label="Errors"
        active={severityFilters.has('error')}
        colorClass="text-red-500 bg-red-500/10"
        onToggle={() => toggleSeverity('error')}
      />

      <FilterChip
        severity="warning"
        icon={AlertTriangle}
        label="Warnings"
        active={severityFilters.has('warning')}
        colorClass="text-amber-500 bg-amber-500/10"
        onToggle={() => toggleSeverity('warning')}
      />

      <FilterChip
        severity="info"
        icon={Info}
        label="Info"
        active={severityFilters.has('info')}
        colorClass="text-blue-500 bg-blue-500/10"
        onToggle={() => toggleSeverity('info')}
      />

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        type="button"
        onClick={toggleHeatmap}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
          'hover:shadow-sm',
          heatmapActive
            ? 'text-orange-500 bg-orange-500/10 border-orange-500/30 shadow-sm'
            : 'border-border text-muted-foreground opacity-50 hover:opacity-75',
        )}
      >
        <Flame className="h-3 w-3" />
        Heatmap
      </button>

      {/* Focus mode exit chip — only visible when a node is focused */}
      {focusedNodeName && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => useGraphStore.getState().clearFocusMode()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
              'hover:shadow-sm text-primary bg-primary/10 border-primary/30 shadow-sm',
            )}
            title="Exit focus mode (Esc)"
          >
            <Crosshair className="h-3 w-3" />
            <span className="max-w-35 truncate">{focusedNodeName}</span>
            <X className="h-3 w-3 opacity-60" />
          </button>
        </>
      )}

      {/* Panel toggle buttons — only rendered on desktop (when handlers are provided) */}
      {(onToggleLeft || onToggleRight) && (
        <div className="ml-auto flex items-center gap-0.5 pl-1">
          {onToggleLeft && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn('h-6 w-6', leftPanelOpen && 'bg-accent text-accent-foreground')}
                  onClick={onToggleLeft}
                  aria-label={leftPanelOpen ? 'Hide file tree' : 'Show file tree'}
                >
                  <PanelLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {leftPanelOpen ? 'Hide file tree' : 'Show file tree'}
              </TooltipContent>
            </Tooltip>
          )}
          {onToggleRight && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn('h-6 w-6', rightPanelOpen && 'bg-accent text-accent-foreground')}
                  onClick={onToggleRight}
                  aria-label={rightPanelOpen ? 'Hide inspector' : 'Show inspector'}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {rightPanelOpen ? 'Hide inspector' : 'Show inspector'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
