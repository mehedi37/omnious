'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NODE_TYPE_COLORS, NODE_TYPE_ICONS } from '@/lib/oir/constants';
import { type OmniousNode, useGraphStore } from '@/lib/stores/graph-store';
import { cn } from '@/lib/utils';

// ─── Result item ─────────────────────────────────────────────────────────────

function SearchResultItem({ node, onSelect }: { node: OmniousNode; onSelect: (id: string) => void }) {
  const TypeIcon = NODE_TYPE_ICONS[node.data.oirType];
  const colorClass = NODE_TYPE_COLORS[node.data.oirType] ?? 'text-muted-foreground';
  const filePath = node.data.filePath;

  return (
    <button
      type="button"
      className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-accent/60 transition-colors rounded-md"
      onClick={() => onSelect(node.id)}
    >
      {TypeIcon && <TypeIcon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', colorClass)} />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{node.data.label ?? node.id}</p>
        {filePath && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{filePath}</p>
        )}
      </div>
      <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 self-start mt-0.5">
        {node.data.oirType}
      </Badge>
    </button>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function GraphSearchPanel({ className }: { className?: string }) {
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const searchResultIds = useGraphStore((s) => s.searchResultIds);
  const nodes = useGraphStore((s) => s.nodes);
  const nodeSearchOpen = useGraphStore((s) => s.nodeSearchOpen);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when opened
  useEffect(() => {
    if (nodeSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [nodeSearchOpen]);

  // Keyboard: Esc closes, Ctrl+F opens
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && nodeSearchOpen) {
        useGraphStore.getState().setNodeSearchOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only intercept if focused inside graph area (not another input)
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          useGraphStore.getState().setNodeSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeSearchOpen]);

  const searchResults = searchQuery.trim()
    ? nodes.filter((n) => searchResultIds.has(n.id))
    : [];

  function handleSelect(nodeId: string) {
    useGraphStore.getState().setFocusMode(nodeId);
    useGraphStore.getState().selectNode(nodeId);
  }

  if (!nodeSearchOpen) return null;

  return (
    <div
      className={cn(
        'absolute top-0 left-0 right-0 z-20 bg-background/97 backdrop-blur-sm border-b shadow-lg',
        className,
      )}
    >
      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => useGraphStore.getState().setSearchQuery(e.target.value)}
          placeholder="Search nodes by name, type, or path…"
          className="h-7 border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => useGraphStore.getState().setSearchQuery('')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => useGraphStore.getState().setNodeSearchOpen(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground ml-1"
          title="Close search (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Results */}
      {searchQuery.trim() && (
        <div className="border-t">
          {searchResults.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No nodes match &ldquo;{searchQuery}&rdquo;
            </p>
          ) : (
            <>
              <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-b bg-muted/30">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} — click to focus
              </p>
              <ScrollArea className="max-h-64">
                <div className="p-1.5 space-y-0.5">
                  {searchResults.slice(0, 50).map((node) => (
                    <SearchResultItem key={node.id} node={node} onSelect={handleSelect} />
                  ))}
                  {searchResults.length > 50 && (
                    <p className="px-3 py-2 text-[10px] text-muted-foreground text-center">
                      +{searchResults.length - 50} more — refine your search
                    </p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      )}
    </div>
  );
}
