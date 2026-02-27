'use client';

import { useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { OIRNodeType } from '@/lib/oir/types';
import { useGraphStore, graphRef } from '@/lib/stores/graph-store';
import {
  Braces, Component, Route, Database, FileCode, Box,
  Layers, Radio, Antenna, Globe, Variable, Type,
  ChevronDown, ChevronRight, FolderOpen,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
 * Floating filter panel with two collapsible sections:
 * 1. Groups — toggle visibility of group (directory) nodes
 * 2. Node types — toggle visibility based on OIR type
 */
export function GraphFilters() {
  const nodeTypeFilters = useGraphStore((s) => s.nodeTypeFilters);
  const toggleFilter = useGraphStore((s) => s.toggleNodeTypeFilter);
  const viewMode = useGraphStore((s) => s.viewMode);
  const graphVersion = useGraphStore((s) => s.graphVersion);

  const [typesOpen, setTypesOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(true);

  // Gather groups + type counts from graphology
  const { typeCounts, groups } = useMemo(() => {
    const counts: Record<string, number> = {};
    const grps: { id: string; label: string; childCount: number; hidden: boolean }[] = [];
    graphRef.current?.forEachNode((id, attrs) => {
      if (attrs.isGroup) {
        grps.push({
          id,
          label: attrs.label,
          childCount: attrs.childCount ?? 0,
          hidden: !!attrs.hidden,
        });
      } else if (!attrs.hidden && attrs.oirType) {
        counts[attrs.oirType] = (counts[attrs.oirType] ?? 0) + 1;
      }
    });
    grps.sort((a, b) => a.label.localeCompare(b.label));
    return { typeCounts: counts, groups: grps };
  }, [graphVersion]);

  const isTypeVisible = (type: OIRNodeType) => {
    if (nodeTypeFilters.size === 0) return true;
    return nodeTypeFilters.has(type);
  };

  const allTypesVisible = nodeTypeFilters.size === 0;

  const handleSelectAllTypes = () => {
    useGraphStore.getState().setNodeTypeFilters(new Set<OIRNodeType>());
  };

  const handleClearAllTypes = () => {
    useGraphStore.getState().setNodeTypeFilters(new Set<OIRNodeType>(['__none__' as OIRNodeType]));
  };

  const handleToggleGroup = (groupId: string) => {
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(groupId)) return;
    const current = graph.getNodeAttribute(groupId, 'hidden');
    graph.setNodeAttribute(groupId, 'hidden', !current);
    // Also toggle edges connected to this group
    graph.forEachEdge(groupId, (edgeId) => {
      graph.setEdgeAttribute(edgeId, 'hidden', !current);
    });
    useGraphStore.getState().syncFromGraphology();
  };

  return (
    <div className="absolute top-12 left-3 z-40 w-52 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg p-2 max-h-[70vh] overflow-y-auto">
      {/* Groups section — only in grouped mode */}
      {viewMode === 'grouped' && groups.length > 0 && (
        <Collapsible open={groupsOpen} onOpenChange={setGroupsOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 w-full px-1 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {groupsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Groups ({groups.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-0.5 mt-0.5 mb-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => handleToggleGroup(group.id)}
                className={cn(
                  'flex items-center gap-2 w-full rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted',
                  group.hidden && 'opacity-40',
                )}
              >
                <Checkbox
                  checked={!group.hidden}
                  className="h-3.5 w-3.5 pointer-events-none"
                />
                <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{group.label}</span>
                <span className="text-[9px] font-medium tabular-nums opacity-60 ml-auto shrink-0">
                  {group.childCount}
                </span>
              </button>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Node types section */}
      <Collapsible open={typesOpen} onOpenChange={setTypesOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              {typesOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Node Types
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={allTypesVisible ? handleClearAllTypes : handleSelectAllTypes}
          >
            {allTypesVisible ? 'Clear all' : 'Select all'}
          </Button>
        </div>
        <CollapsibleContent className="space-y-0.5 mt-0.5">
          {ALL_NODE_TYPES.map((type) => {
            const Icon = ICON_MAP[type] ?? FileCode;
            const checked = isTypeVisible(type);
            const count = typeCounts[type] ?? 0;

            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleFilter(type)}
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
                  {count}
                </span>
              </button>
            );
          })}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
