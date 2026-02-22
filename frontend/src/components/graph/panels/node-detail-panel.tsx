'use client';

import { Braces, Crosshair, FolderOpen, FileCode, Layers, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import type { SigmaNodeAttributes } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

/** Read node attributes directly from graphology */
function getSelectedAttrs(): SigmaNodeAttributes | null {
  const { selectedNodeIds } = useGraphStore.getState();
  if (selectedNodeIds.size === 0) return null;
  const graph = graphRef.current;
  if (!graph) return null;

  const firstId = selectedNodeIds.values().next().value as string;
  if (!graph.hasNode(firstId)) return null;
  return graph.getNodeAttributes(firstId);
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

          {/* Type breakdown */}
          {attrs.typeBreakdown && Object.keys(attrs.typeBreakdown).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Type breakdown</p>
              <div className="rounded-md bg-muted p-2 space-y-1">
                {Object.entries(attrs.typeBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex justify-between text-xs">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 ${NODE_BG_CLASSES[type as keyof typeof NODE_BG_CLASSES] ?? ''}`}
                      >
                        {type.replace('_', ' ')}
                      </Badge>
                      <span className="font-mono text-muted-foreground">{count}</span>
                    </div>
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
      </div>
    </ScrollArea>
  );
}
