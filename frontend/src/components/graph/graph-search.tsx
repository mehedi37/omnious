'use client';

import { useReactFlow } from '@xyflow/react';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { NODE_BG_CLASSES } from '@/lib/oir/constants';
import type { GraphNodeData } from '@/lib/oir/transforms';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

/**
 * Floating search popover for finding graph nodes by name, file path, or type.
 * Opens with Ctrl+F / Cmd+F, supports keyboard navigation (↑↓ Enter Esc).
 */
export function GraphSearch() {
  const open = useGraphStore((s) => s.nodeSearchOpen);
  const nodes = useGraphStore((s) => s.nodes);
  const { setCenter } = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter nodes by name/file/type match
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return nodes
      .filter((n) => {
        const d = n.data as GraphNodeData;
        return (
          d.label.toLowerCase().includes(q) ||
          (d.filePath ?? '').toLowerCase().includes(q) ||
          d.oirType.toLowerCase().includes(q)
        );
      })
      .slice(0, 30);
  }, [nodes, query]);

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

  const close = useCallback(() => {
    useGraphStore.getState().setNodeSearchOpen(false);
    setQuery('');
  }, []);

  const navigateToNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      useGraphStore.getState().selectNode(nodeId);
      useUIStore.getState().setDetailPanelOpen(true);

      const x = node.position.x + (node.measured?.width ?? 200) / 2;
      const y = node.position.y + (node.measured?.height ?? 60) / 2;
      setCenter(x, y, { duration: 400, zoom: 1.2 });

      close();
    },
    [nodes, setCenter, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [results, selectedIndex, close, navigateToNode],
  );

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
              results.map((node, i) => {
                const d = node.data as GraphNodeData;
                return (
                  <button
                    type="button"
                    key={node.id}
                    onClick={() => navigateToNode(node.id)}
                    className={`w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      i === selectedIndex
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted text-foreground/80'
                    }`}
                  >
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 shrink-0 ${NODE_BG_CLASSES[d.oirType] ?? ''}`}
                    >
                      {d.oirType.replace('_', ' ')}
                    </Badge>
                    <span className="font-medium truncate">{d.label}</span>
                    {d.filePath && (
                      <span className="text-[11px] text-muted-foreground truncate ml-auto pl-2">
                        {d.filePath}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Keyboard hints */}
        <div className="border-t px-3 py-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            <kbd className="px-1 rounded bg-muted font-mono text-[10px]">↑↓</kbd> Navigate
          </span>
          <span>
            <kbd className="px-1 rounded bg-muted font-mono text-[10px]">Enter</kbd> Go to node
          </span>
          <span>
            <kbd className="px-1 rounded bg-muted font-mono text-[10px]">Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
