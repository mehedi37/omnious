'use client';

import {
  ArrowDownToLine, ArrowUpFromLine, Braces, Component, Route, Database, FileCode, Box,
  Layers, Radio, Antenna, Globe, Variable, Type, Crosshair, FolderOpen, X,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import type { GraphNodeAttributes, GraphEdgeAttributes } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';

/** Read node attributes directly from graphology */
function getSelectedAttrs(): GraphNodeAttributes | null {
  const { selectedNodeIds } = useGraphStore.getState();
  if (selectedNodeIds.size === 0) return null;
  const graph = graphRef.current;
  if (!graph) return null;

  const firstId = selectedNodeIds.values().next().value as string;
  if (!graph.hasNode(firstId)) return null;
  return graph.getNodeAttributes(firstId);
}

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

interface ConnectedNode {
  id: string;
  label: string;
  oirType: string;
  edgeType: string;
}

function getConnectedNodes(nodeId: string): { incoming: ConnectedNode[]; outgoing: ConnectedNode[] } {
  const graph = graphRef.current;
  if (!graph || !graph.hasNode(nodeId)) return { incoming: [], outgoing: [] };

  const incoming: ConnectedNode[] = [];
  const outgoing: ConnectedNode[] = [];

  graph.forEachInEdge(nodeId, (_edgeId, edgeAttrs: GraphEdgeAttributes, source) => {
    if (source === nodeId) return;
    if (!graph.hasNode(source)) return;
    const srcAttrs = graph.getNodeAttributes(source);
    if (srcAttrs.hidden || srcAttrs.isGroup) return;
    incoming.push({
      id: source,
      label: srcAttrs.label,
      oirType: srcAttrs.oirType ?? 'module',
      edgeType: edgeAttrs.edgeType,
    });
  });

  graph.forEachOutEdge(nodeId, (_edgeId, edgeAttrs: GraphEdgeAttributes, _source, target) => {
    if (target === nodeId) return;
    if (!graph.hasNode(target)) return;
    const tgtAttrs = graph.getNodeAttributes(target);
    if (tgtAttrs.hidden || tgtAttrs.isGroup) return;
    outgoing.push({
      id: target,
      label: tgtAttrs.label,
      oirType: tgtAttrs.oirType ?? 'module',
      edgeType: edgeAttrs.edgeType,
    });
  });

  // Deduplicate (multi-graph can have multiple edges between same nodes)
  const dedup = (arr: ConnectedNode[]) => {
    const seen = new Set<string>();
    return arr.filter((n) => {
      const key = `${n.id}:${n.edgeType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return { incoming: dedup(incoming), outgoing: dedup(outgoing) };
}

export function NodeDetailPanel() {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  // Re-render when graphVersion changes (to pick up new attributes)
  useGraphStore((s) => s.graphVersion);

  const attrs = getSelectedAttrs();

  if (!attrs) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        Select a node to view details
      </div>
    );
  }

  const selectedNodeId = selectedNodeIds.values().next().value as string;
  const isCurrentlyFocused = focusedNodeId === selectedNodeId;

  const handleClose = () => {
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
  };

  const handleFocus = () => {
    if (isCurrentlyFocused) {
      useGraphStore.getState().clearFocusMode();
    } else {
      useGraphStore.getState().setFocusMode(selectedNodeId);
    }
  };

  // --- Group node detail view ---
  if (attrs.isGroup) {
    return (
      <ScrollArea className="h-full">
        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Badge
                variant="outline"
                className={`text-[10px] mb-2 ${NODE_BG_CLASSES[(attrs.dominantType ?? 'module') as keyof typeof NODE_BG_CLASSES] ?? ''}`}
              >
                group · {(attrs.dominantType ?? 'module').replace('_', ' ')}
              </Badge>
              <h3 className="text-lg font-semibold truncate">{attrs.label}</h3>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isCurrentlyFocused ? 'secondary' : 'ghost'}
                    size="icon"
                    className={`h-7 w-7 ${isCurrentlyFocused ? 'bg-primary/10 text-primary' : ''}`}
                    onClick={handleFocus}
                  >
                    <Crosshair className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isCurrentlyFocused ? 'Exit focus mode (Esc)' : 'Focus on connected nodes (N)'}
                </TooltipContent>
              </Tooltip>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Directory */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Directory</p>
            <div className="flex items-center gap-2 text-sm">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-xs truncate">{attrs.directory || '/'}</span>
            </div>
          </div>

          {/* Child count */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Nodes in group</p>
            <div className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{attrs.childCount ?? 0} node{(attrs.childCount ?? 0) !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Type breakdown — expandable to show individual child nodes */}
          {attrs.typeBreakdown && Object.keys(attrs.typeBreakdown).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type breakdown</p>
              <div className="rounded-md bg-muted p-2 space-y-0.5">
                {Object.entries(attrs.typeBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <TypeBreakdownRow
                      key={type}
                      type={type}
                      count={count}
                      groupNodeId={selectedNodeId}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    );
  }

  // --- Individual node detail view ---
  if (!attrs.oirType) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        Select a node to view details
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Badge
              variant="outline"
              className={`text-[10px] mb-2 ${NODE_BG_CLASSES[attrs.oirType] ?? ''}`}
            >
              {attrs.oirType.replace('_', ' ')}
            </Badge>
            <h3 className="text-lg font-semibold truncate">{attrs.label}</h3>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isCurrentlyFocused ? 'secondary' : 'ghost'}
                  size="icon"
                  className={`h-7 w-7 ${isCurrentlyFocused ? 'bg-primary/10 text-primary' : ''}`}
                  onClick={handleFocus}
                >
                  <Crosshair className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isCurrentlyFocused ? 'Exit focus mode (Esc)' : 'Focus on connected nodes (N)'}
              </TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Separator />

        {/* File location */}
        {attrs.filePath && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">File</p>
            <div className="flex items-center gap-2 text-sm">
              <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-xs truncate">{attrs.filePath}</span>
            </div>
            {(attrs.lineStart || attrs.lineEnd) && (
              <p className="text-xs text-muted-foreground pl-6">
                Lines {attrs.lineStart}–{attrs.lineEnd ?? '?'}
              </p>
            )}
          </div>
        )}

        {/* Signature */}
        {attrs.signature && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Signature</p>
            <div className="flex items-start gap-2">
              <Braces className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <pre className="text-xs font-mono bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap flex-1">
                {attrs.signature}
              </pre>
            </div>
          </div>
        )}

        {/* Doc comment */}
        {attrs.docComment && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Documentation</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{attrs.docComment}</p>
          </div>
        )}

        {/* Error info */}
        {attrs.errorCount != null && attrs.errorCount > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Errors</p>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">
                {attrs.errorCount} error{attrs.errorCount > 1 ? 's' : ''}
              </Badge>
              {attrs.errorSeverity && (
                <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400">
                  {attrs.errorSeverity}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Metadata */}
        {Object.keys(attrs.metadata ?? {}).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Metadata</p>
            <div className="rounded-md bg-muted p-2 space-y-1">
              {Object.entries(attrs.metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{key}</span>
                  <span className="font-mono truncate ml-2 max-w-[60%] text-right">
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connected Nodes */}
        <ConnectedNodesList nodeId={selectedNodeId} />
      </div>
    </ScrollArea>
  );
}

// ─── Type Breakdown Row (expandable) ─────────────────────────────────────────

function getChildNodesOfType(groupNodeId: string, type: string): { id: string; label: string }[] {
  const graph = graphRef.current;
  if (!graph || !graph.hasNode(groupNodeId)) return [];
  const childIds = graph.getNodeAttributes(groupNodeId).childNodeIds ?? [];
  const result: { id: string; label: string }[] = [];
  for (const id of childIds) {
    if (!graph.hasNode(id)) continue;
    const attrs = graph.getNodeAttributes(id);
    if (attrs.oirType === type) {
      result.push({ id, label: attrs.label });
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

function TypeBreakdownRow({ type, count, groupNodeId }: { type: string; count: number; groupNodeId: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON_MAP[type] ?? FileCode;
  const bgClass = NODE_BG_CLASSES[type as keyof typeof NODE_BG_CLASSES] ?? '';

  function handleChildClick(childId: string) {
    // Switch to individual mode and focus on the child node
    useGraphStore.getState().setViewMode('individual');
    setTimeout(() => {
      useGraphStore.getState().requestLayout();
      setTimeout(() => {
        useGraphStore.getState().selectNode(childId);
        useGraphStore.getState().setFocusMode(childId);
        useUIStore.getState().setDetailPanelOpen(true);
        const graph = graphRef.current;
        if (graph && graph.hasNode(childId)) {
          const attrs = graph.getNodeAttributes(childId);
          window.dispatchEvent(
            new CustomEvent('omnious:center-node', { detail: { x: attrs.x, y: attrs.y } }),
          );
        }
      }, 200);
    }, 50);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-between w-full text-xs rounded px-1 py-0.5 hover:bg-background/50 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            {open ? (
              <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
            )}
            <Badge
              variant="outline"
              className={`text-[9px] px-1.5 py-0 ${bgClass}`}
            >
              {type.replace('_', ' ')}
            </Badge>
          </div>
          <span className="font-mono text-muted-foreground">{count}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4 space-y-0.5 mt-0.5">
        {open && getChildNodesOfType(groupNodeId, type).map((child) => (
          <button
            key={child.id}
            type="button"
            onClick={() => handleChildClick(child.id)}
            className="flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-xs text-left hover:bg-background/70 transition-colors group"
          >
            <div className={cn('flex items-center justify-center rounded p-0.5 shrink-0', bgClass)}>
              <Icon className="h-2.5 w-2.5" />
            </div>
            <span className="truncate group-hover:text-foreground">{child.label}</span>
          </button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Connected Nodes Sub-component ──────────────────────────────────────────

const COLLAPSE_THRESHOLD = 6;

function ConnectedNodesList({ nodeId }: { nodeId: string }) {
  // Re-render when graphVersion changes — memoize the expensive graph traversal
  const graphVersion = useGraphStore((s) => s.graphVersion);
  const { incoming, outgoing } = useMemo(
    () => getConnectedNodes(nodeId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeId, graphVersion],
  );
  const [incomingSectionOpen, setIncomingSectionOpen] = useState(true);
  const [outgoingSectionOpen, setOutgoingSectionOpen] = useState(true);
  const [incomingOpen, setIncomingOpen] = useState(true);
  const [outgoingOpen, setOutgoingOpen] = useState(true);

  if (incoming.length === 0 && outgoing.length === 0) return null;

  function handleNavigate(targetId: string) {
    // Enter focus mode on the clicked node — setFocusMode already fits the viewport
    useGraphStore.getState().setFocusMode(targetId);
    useGraphStore.getState().highlightConnectedEdges(targetId);
    useUIStore.getState().setDetailPanelOpen(true);
  }

  return (
    <>
      <Separator />

      {/* Incoming connections */}
      {incoming.length > 0 && (
        <Collapsible open={incomingSectionOpen} onOpenChange={setIncomingSectionOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 w-full hover:bg-muted/50 rounded-md px-1 py-0.5 transition-colors"
            >
              {incomingSectionOpen ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Incoming ({incoming.length})
              </p>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1">
            {incoming.length <= COLLAPSE_THRESHOLD ? (
              <div className="flex flex-wrap gap-1">
                {incoming.map((node) => (
                  <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                ))}
              </div>
            ) : (
              <Collapsible open={incomingOpen} onOpenChange={setIncomingOpen}>
                <div className="flex flex-wrap gap-1">
                  {incoming.slice(0, COLLAPSE_THRESHOLD).map((node) => (
                    <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                  ))}
                </div>
                <CollapsibleContent className="mt-1">
                  <div className="flex flex-wrap gap-1">
                    {incoming.slice(COLLAPSE_THRESHOLD).map((node) => (
                      <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                    ))}
                  </div>
                </CollapsibleContent>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full h-6 text-xs text-muted-foreground mt-1">
                    {incomingOpen ? 'Show less' : `Show ${incoming.length - COLLAPSE_THRESHOLD} more…`}
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Outgoing connections */}
      {outgoing.length > 0 && (
        <Collapsible open={outgoingSectionOpen} onOpenChange={setOutgoingSectionOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 w-full hover:bg-muted/50 rounded-md px-1 py-0.5 transition-colors"
            >
              {outgoingSectionOpen ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              <ArrowUpFromLine className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Outgoing ({outgoing.length})
              </p>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1">
            {outgoing.length <= COLLAPSE_THRESHOLD ? (
              <div className="flex flex-wrap gap-1">
                {outgoing.map((node) => (
                  <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                ))}
              </div>
            ) : (
              <Collapsible open={outgoingOpen} onOpenChange={setOutgoingOpen}>
                <div className="flex flex-wrap gap-1">
                  {outgoing.slice(0, COLLAPSE_THRESHOLD).map((node) => (
                    <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                  ))}
                </div>
                <CollapsibleContent className="mt-1">
                  <div className="flex flex-wrap gap-1">
                    {outgoing.slice(COLLAPSE_THRESHOLD).map((node) => (
                      <ConnectedNodeItem key={`${node.id}:${node.edgeType}`} node={node} onNavigate={handleNavigate} />
                    ))}
                  </div>
                </CollapsibleContent>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full h-6 text-xs text-muted-foreground mt-1">
                    {outgoingOpen ? 'Show less' : `Show ${outgoing.length - COLLAPSE_THRESHOLD} more…`}
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function ConnectedNodeItem({
  node,
  onNavigate,
}: {
  node: ConnectedNode;
  onNavigate: (id: string) => void;
}) {
  const Icon = ICON_MAP[node.oirType] ?? FileCode;
  const bgClass = NODE_BG_CLASSES[node.oirType as keyof typeof NODE_BG_CLASSES] ?? '';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onNavigate(node.id)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
            'hover:bg-muted/80 hover:border-foreground/20 cursor-pointer shrink-0',
            bgClass,
          )}
        >
          <Icon className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate max-w-[120px]">{node.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <span className="font-medium">{node.label}</span>
        <span className="text-muted-foreground ml-1">· {node.edgeType.replace('_', ' ')}</span>
      </TooltipContent>
    </Tooltip>
  );
}
