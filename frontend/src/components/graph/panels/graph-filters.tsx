'use client';

import { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NODE_BG_CLASSES, NODE_ICONS } from '@/lib/oir/constants';
import type { OIRNodeType } from '@/lib/oir/types';
import { useGraphStore, graphRef } from '@/lib/stores/graph-store';
import {
  Braces, Component, Route, Database, FileCode, Box,
  Layers, Radio, Antenna, Globe, Variable, Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  function: Braces,
  component: Component,
  route: Route,
  database_query: Database,
  module: FileCode,
  class: Box,
  middleware: Layers,
  event_emitter: Radio,
  event_listener: Antenna,
  external_api: Globe,
  variable: Variable,
  type_def: Type,
};

const ALL_NODE_TYPES: OIRNodeType[] = [
  'function', 'component', 'route', 'database_query', 'module',
  'class', 'middleware', 'event_emitter', 'event_listener',
  'external_api', 'variable', 'type_def',
];

/**
 * Floating filter panel for toggling node type visibility.
 * Uses checkboxes per OIR node type with themed colors.
 */
export function GraphFilters() {
  const nodeTypeFilters = useGraphStore((s) => s.nodeTypeFilters);
  const toggleFilter = useGraphStore((s) => s.toggleNodeTypeFilter);
  const graphVersion = useGraphStore((s) => s.graphVersion);

  // Count visible individual nodes per type (recalculate when graph changes)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    graphRef.current?.forEachNode((_, attrs) => {
      if (!attrs.isGroup && !attrs.hidden && attrs.oirType) {
        counts[attrs.oirType] = (counts[attrs.oirType] ?? 0) + 1;
      }
    });
    return counts;
  }, [graphVersion]);

  const handleToggle = (type: OIRNodeType) => {
    toggleFilter(type);
  };

  // A type is "checked" (visible) when filters are empty OR type is in the filter set
  const isTypeVisible = (type: OIRNodeType) => {
    if (nodeTypeFilters.size === 0) return true;
    return nodeTypeFilters.has(type);
  };

  const allVisible = nodeTypeFilters.size === 0;

  const handleSelectAll = () => {
    useGraphStore.getState().setNodeTypeFilters(new Set<OIRNodeType>());
  };

  const handleClearAll = () => {
    useGraphStore.getState().setNodeTypeFilters(new Set<OIRNodeType>(['__none__' as OIRNodeType]));
  };

  return (
    <div className="absolute top-12 left-3 z-40 w-48 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg p-2">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Node Types
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] text-muted-foreground"
          onClick={allVisible ? handleClearAll : handleSelectAll}
        >
          {allVisible ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <div className="space-y-0.5">
        {ALL_NODE_TYPES.map((type) => {
          const Icon = ICON_MAP[type] ?? FileCode;
          const checked = isTypeVisible(type);

          return (
            <button
              key={type}
              type="button"
              onClick={() => handleToggle(type)}
              className={cn(
                'flex items-center gap-2 w-full rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted',
                !checked && 'opacity-40',
                checked && (NODE_BG_CLASSES[type as keyof typeof NODE_BG_CLASSES] ?? ''),
              )}
            >
              <Checkbox
                checked={checked}
                className="h-3.5 w-3.5 pointer-events-none"
              />
              <Icon className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">{type.replace('_', ' ')}</span>
              <span className="text-[9px] font-medium tabular-nums opacity-60 ml-auto shrink-0">
                {typeCounts[type] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
