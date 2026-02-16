'use client';

import { X, FileCode, Braces, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { NODE_BG_CLASSES, NODE_ICONS } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import type { Node } from '@xyflow/react';

export function NodeDetailPanel() {
  const nodes = useGraphStore((s) => s.nodes);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);

  const selectedNode = nodes.find((n: Node) => selectedNodeIds.has(n.id));
  const data = selectedNode?.data as GraphNodeData | undefined;

  if (!selectedNode || !data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        Select a node to view details
      </div>
    );
  }

  const handleClose = () => {
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Badge
              variant="outline"
              className={`text-[10px] mb-2 ${NODE_BG_CLASSES[data.oirType] ?? ''}`}
            >
              {data.oirType.replace('_', ' ')}
            </Badge>
            <h3 className="text-lg font-semibold truncate">{data.label}</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator />

        {/* File location */}
        {data.filePath && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              File
            </p>
            <div className="flex items-center gap-2 text-sm">
              <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-xs truncate">{data.filePath}</span>
            </div>
            {(data.lineStart || data.lineEnd) && (
              <p className="text-xs text-muted-foreground pl-6">
                Lines {data.lineStart}–{data.lineEnd ?? '?'}
              </p>
            )}
          </div>
        )}

        {/* Signature */}
        {data.signature && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Signature
            </p>
            <div className="flex items-start gap-2">
              <Braces className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <pre className="text-xs font-mono bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap flex-1">
                {data.signature}
              </pre>
            </div>
          </div>
        )}

        {/* Doc comment */}
        {data.docComment && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Documentation
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">{data.docComment}</p>
          </div>
        )}

        {/* Error info */}
        {data.errorCount != null && data.errorCount > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Errors
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">{data.errorCount} error{data.errorCount > 1 ? 's' : ''}</Badge>
              {data.errorSeverity && (
                <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400">
                  {data.errorSeverity}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Metadata */}
        {Object.keys(data.metadata ?? {}).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Metadata
            </p>
            <div className="rounded-md bg-muted p-2 space-y-1">
              {Object.entries(data.metadata).map(([key, value]) => (
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
