'use client';

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Braces,
  Crosshair,
  FileCode,
  Sparkles,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import { useAIStore } from '@/lib/stores/ai-store';
import { type OmniousNodeData, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { cn } from '@/lib/utils';
import { trpc } from '@/trpc/client';

/**
 * Gets the selected node's data from the React Flow store.
 */
function useSelectedNodeData(): { nodeId: string; data: OmniousNodeData } | null {
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const nodeMap = useGraphStore((s) => s.nodeMap);

  return useMemo(() => {
    if (selectedNodeIds.size === 0) return null;
    const firstId = selectedNodeIds.values().next().value as string;
    const nodeData = nodeMap.get(firstId);
    if (!nodeData) return null;
    return { nodeId: firstId, data: nodeData };
  }, [selectedNodeIds, nodeMap]);
}

/**
 * Gets connected nodes from the edges in the React Flow store.
 */
function useConnectedNodes(nodeId: string | null) {
  const edges = useGraphStore((s) => s.edges);
  const nodeMap = useGraphStore((s) => s.nodeMap);

  return useMemo(() => {
    if (!nodeId) return { incoming: [], outgoing: [] };

    const incoming: Array<{ id: string; label: string; oirType: string; edgeType: string }> = [];
    const outgoing: Array<{ id: string; label: string; oirType: string; edgeType: string }> = [];

    const seenIn = new Set<string>();
    const seenOut = new Set<string>();

    for (const edge of edges) {
      if (edge.target === nodeId && edge.source !== nodeId) {
        const key = `${edge.source}:${edge.data?.edgeType ?? 'unknown'}`;
        if (!seenIn.has(key)) {
          seenIn.add(key);
          const srcData = nodeMap.get(edge.source);
          if (srcData) {
            incoming.push({
              id: edge.source,
              label: srcData.label,
              oirType: srcData.oirType ?? 'module',
              edgeType: edge.data?.edgeType ?? 'unknown',
            });
          }
        }
      }
      if (edge.source === nodeId && edge.target !== nodeId) {
        const key = `${edge.target}:${edge.data?.edgeType ?? 'unknown'}`;
        if (!seenOut.has(key)) {
          seenOut.add(key);
          const tgtData = nodeMap.get(edge.target);
          if (tgtData) {
            outgoing.push({
              id: edge.target,
              label: tgtData.label,
              oirType: tgtData.oirType ?? 'module',
              edgeType: edge.data?.edgeType ?? 'unknown',
            });
          }
        }
      }
    }

    return { incoming, outgoing };
  }, [nodeId, edges, nodeMap]);
}

export function NodeDetailPanel() {
  const selected = useSelectedNodeData();
  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        Select a node to view details
      </div>
    );
  }

  const { nodeId, data: attrs } = selected;
  const isCurrentlyFocused = focusedNodeId === nodeId;

  const handleClose = () => {
    useGraphStore.getState().deselectAll();
  };

  const handleFocus = () => {
    if (isCurrentlyFocused) {
      useGraphStore.getState().clearFocusMode();
    } else {
      useGraphStore.getState().setFocusMode(nodeId);
      window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
    }
  };

  const bgClass = NODE_BG_CLASSES[attrs.oirType as keyof typeof NODE_BG_CLASSES] ?? '';

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Badge variant="outline" className={cn('text-[10px] mb-2', bgClass)}>
              {attrs.oirType.replace(/_/g, ' ')}
            </Badge>
            <h3 className="text-lg font-semibold truncate">{attrs.label}</h3>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isCurrentlyFocused ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn('h-7 w-7', isCurrentlyFocused && 'bg-primary/10 text-primary')}
                  onClick={handleFocus}
                >
                  <Crosshair className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isCurrentlyFocused ? 'Exit focus mode (Esc)' : 'Focus on connected nodes'}
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              File
            </p>
            <div className="flex items-center gap-2 text-sm">
              <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-xs truncate">{attrs.filePath}</span>
            </div>
            {(attrs.lineStart != null || attrs.lineEnd != null) && (
              <p className="text-xs text-muted-foreground pl-6">
                Lines {attrs.lineStart ?? '?'}–{attrs.lineEnd ?? '?'}
              </p>
            )}
          </div>
        )}

        {/* Signature */}
        {attrs.signature && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Signature
            </p>
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Documentation
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">{attrs.docComment}</p>
          </div>
        )}

        {/* AI-generated file summary */}
        {attrs.filePath && <NodeFileSummary nodeId={nodeId} filePath={attrs.filePath} />}

        {/* Errors section */}
        <NodeErrorList nodeId={nodeId} nodeLabel={attrs.label} />

        {/* Relevance (for AI query results) */}
        {attrs.relevance != null && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Relevance
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round(attrs.relevance * 100)}%` }}
                />
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {Math.round(attrs.relevance * 100)}%
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {attrs.source === 'seed' ? 'Direct semantic match' : 'Discovered via graph traversal'}
            </p>
          </div>
        )}

        {/* Metadata */}
        {Object.keys(attrs.metadata ?? {}).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Metadata
            </p>
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
        <ConnectedNodesList nodeId={nodeId} />
      </div>
    </ScrollArea>
  );
}

const CHIP_COLLAPSE_THRESHOLD = 5;

function ConnectedNodesList({ nodeId }: { nodeId: string }) {
  const { incoming, outgoing } = useConnectedNodes(nodeId);
  const [showAllIn, setShowAllIn] = useState(false);
  const [showAllOut, setShowAllOut] = useState(false);

  if (incoming.length === 0 && outgoing.length === 0) return null;

  const visibleIn = showAllIn ? incoming : incoming.slice(0, CHIP_COLLAPSE_THRESHOLD);
  const visibleOut = showAllOut ? outgoing : outgoing.slice(0, CHIP_COLLAPSE_THRESHOLD);

  return (
    <div className="space-y-3">
      {incoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <ArrowDownToLine className="h-3 w-3" />
            Incoming ({incoming.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {visibleIn.map((n) => (
              <ConnectedChip key={`${n.id}:${n.edgeType}`} node={n} direction="in" />
            ))}
            {incoming.length > CHIP_COLLAPSE_THRESHOLD && !showAllIn && (
              <button
                type="button"
                onClick={() => setShowAllIn(true)}
                className="text-[10px] text-primary hover:underline px-1"
              >
                Show all {incoming.length}
              </button>
            )}
          </div>
        </div>
      )}
      {outgoing.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <ArrowUpFromLine className="h-3 w-3" />
            Outgoing ({outgoing.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {visibleOut.map((n) => (
              <ConnectedChip key={`${n.id}:${n.edgeType}`} node={n} direction="out" />
            ))}
            {outgoing.length > CHIP_COLLAPSE_THRESHOLD && !showAllOut && (
              <button
                type="button"
                onClick={() => setShowAllOut(true)}
                className="text-[10px] text-primary hover:underline px-1"
              >
                Show all {outgoing.length}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeFileSummary({ nodeId: _nodeId, filePath }: { nodeId: string; filePath: string }) {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  const { data, isLoading } = trpc.graph.getFileSummary.useQuery(
    { projectId: projectId ?? '', filePath },
    { enabled: !!projectId && !!filePath },
  );

  if (!projectId) return null;
  if (isLoading) return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" />
        AI Summary
      </p>
      <p className="text-xs text-muted-foreground animate-pulse">Generating…</p>
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          AI Summary
        </p>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
          AI Generated
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
      <p className="text-[10px] text-muted-foreground/60">
        {data.node_count} symbol{data.node_count !== 1 ? 's' : ''} in file
      </p>
    </div>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  error: 'text-red-600 dark:text-red-400 border-red-500/40 bg-red-500/5',
  warning: 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5',
  info: 'text-blue-600 dark:text-blue-400 border-blue-500/40 bg-blue-500/5',
};

function NodeErrorList({ nodeId, nodeLabel }: { nodeId: string; nodeLabel: string }) {
  const projectId = useWorkspaceStore((s) => s.currentProjectId);

  // Always call hooks unconditionally (Rules of Hooks), use `enabled` to gate the fetch
  const { data, isLoading } = trpc.error.listByNode.useQuery(
    { projectId: projectId ?? '', codeNodeId: nodeId, limit: 5 },
    { enabled: !!projectId },
  );

  const errors = data?.errors ?? [];

  // Conditional logic only after all hooks
  if (!projectId || (!isLoading && errors.length === 0)) return null;

  const handleAskAI = (message: string) => {
    useAIStore.getState().setPrefillMessage(message);
    useUIStore.getState().setActiveDetailTab('ai');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Active Errors
        </p>
        {errors.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={() => handleAskAI(`Explain all active errors on ${nodeLabel}`)}
          >
            <Bot className="h-3 w-3" />
            Ask AI
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading errors…</div>
      ) : (
        <div className="space-y-1.5">
          {errors.map((err) => (
            <div
              key={err.id}
              className={cn(
                'rounded-md border p-2 space-y-1',
                SEVERITY_STYLES[err.severity] ?? SEVERITY_STYLES.error,
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase">{err.error_type}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] opacity-60">×{err.occurrence_count}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4"
                    onClick={() =>
                      handleAskAI(
                        `Explain this error on ${nodeLabel}: ${err.error_type}: ${err.error_message}`,
                      )
                    }
                  >
                    <Bot className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <p className="text-[10px] leading-relaxed line-clamp-2 opacity-80">
                {err.error_message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectedChip({
  node,
  direction,
}: {
  node: { id: string; label: string; oirType: string; edgeType: string };
  direction: 'in' | 'out';
}) {
  const bgClass = NODE_BG_CLASSES[node.oirType as keyof typeof NODE_BG_CLASSES] ?? '';

  const handleClick = () => {
    useGraphStore.getState().selectNode(node.id);
  };

  const arrow = direction === 'in' ? '←' : '→';

  return (
    <Badge
      variant="outline"
      className={cn(
        'cursor-pointer text-[10px] px-1.5 py-0.5 gap-1 hover:bg-muted/80 transition-colors',
        bgClass,
      )}
      onClick={handleClick}
    >
      <span className="opacity-50">{arrow}</span>
      <span className="truncate max-w-30">{node.label}</span>
      <span className="opacity-40">({node.edgeType.replace(/_/g, ' ')})</span>
    </Badge>
  );
}
