'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import type { GraphNodeAttributes } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

interface SearchResult {
  id: string;
  label: string;
  typeStr: string;
  pathStr: string;
  isGroup: boolean;
}

/**
 * Floating search popover for finding graph nodes by name, file path, or type.
 * Opens with Ctrl+F / Cmd+F, supports keyboard navigation.
 */
export function GraphSearch() {
  const open = useGraphStore((s) => s.nodeSearchOpen);
  // Subscribe to graphVersion to rebuild results when graph changes
  useGraphStore((s) => s.graphVersion);

  const reactFlow = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter nodes by name/file/type match — read directly from graphology
  const results: SearchResult[] = (() => {
    if (!query.trim()) return [];
    const graph = graphRef.current;
    if (!graph) return [];

    const q = query.toLowerCase();
    const matches: SearchResult[] = [];

    graph.forEachNode((nodeId, attrs: GraphNodeAttributes) => {
      if (attrs.hidden) return; // skip hidden nodes
      const typeStr = attrs.isGroup ? (attrs.dominantType ?? 'group') : (attrs.oirType ?? '');
      const pathStr = attrs.isGroup ? (attrs.directory ?? '') : (attrs.filePath ?? '');

      if (
        attrs.label.toLowerCase().includes(q) ||
        pathStr.toLowerCase().includes(q) ||
        typeStr.toLowerCase().includes(q)
      ) {
        matches.push({ id: nodeId, label: attrs.label, typeStr, pathStr, isGroup: attrs.isGroup });
      }
    });

    return matches.slice(0, 30);
  })();

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function close() {
    useGraphStore.getState().setNodeSearchOpen(false);
    setQuery('');
  }

  function navigateToNode(nodeId: string) {
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(nodeId)) return;

    useGraphStore.getState().selectNode(nodeId);
    useUIStore.getState().setDetailPanelOpen(true);

    const attrs = graph.getNodeAttributes(nodeId);
    reactFlow.setCenter(attrs.x, attrs.y, { zoom: 2, duration: 400 });
    close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (results[selectedIndex]) {
          navigateToNode(results[selectedIndex].id);
        }
        break;
    }
  }

  if (!open) return null;

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 w-105 max-w-[90vw]">
      <div className="rounded-lg border bg-popover/95 backdrop-blur-md shadow-2xl">
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes by name, file, or type…"
            className="flex-1 bg-transparent px-2 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <span className="text-[11px] text-muted-foreground mr-2">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
          <button type="button" onClick={close} className="p-1 rounded-md hover:bg-muted">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Results list */}
        {query.trim() && (
          <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No nodes matching &ldquo;{query}&rdquo;
              </p>
            ) : (
              results.map((result, i) => (
                <button
                  type="button"
                  key={result.id}
                  onClick={() => navigateToNode(result.id)}
                  className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    i === selectedIndex
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-muted text-foreground/80'
                  }`}
                >
                  <Badge
                    variant="outline"
                    className={`text-[9px] px-1.5 py-0 shrink-0 ${NODE_BG_CLASSES[result.typeStr as keyof typeof NODE_BG_CLASSES] ?? ''}`}
                  >
                    {result.isGroup ? 'group' : result.typeStr.replace('_', ' ')}
                  </Badge>
                  <span className="font-medium truncate">{result.label}</span>
                  {result.pathStr && (
                    <span className="text-[11px] text-muted-foreground truncate ml-auto pl-2">
                      {result.pathStr}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {/* Keyboard hints */}
        <div className="border-t px-3 py-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span><kbd className="px-1 rounded bg-muted font-mono text-[10px]">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 rounded bg-muted font-mono text-[10px]">Enter</kbd> Go to node</span>
          <span><kbd className="px-1 rounded bg-muted font-mono text-[10px]">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
