'use client';

import { Clipboard, Crosshair, Eye, EyeOff, Layers, FolderUp } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { graphRef, useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';

interface GraphContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function GraphContextMenu({ nodeId, x, y, onClose }: GraphContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const graph = graphRef.current;
  const attrs = graph?.hasNode(nodeId) ? graph.getNodeAttributes(nodeId) : null;
  const isGroup = attrs?.isGroup ?? false;
  const viewMode = useGraphStore((s) => s.viewMode);

  // Close on click outside / Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  function handleViewDetails() {
    useGraphStore.getState().selectNode(nodeId);
    useUIStore.getState().setDetailPanelOpen(true);
    onClose();
  }

  function handleFocus() {
    useGraphStore.getState().setFocusMode(nodeId);
    onClose();
  }

  function handleExpandGroup() {
    useGraphStore.getState().setViewMode('individual');
    setTimeout(() => useGraphStore.getState().requestLayout(), 50);
    onClose();
  }

  function handleCombineGroup() {
    // Find the group containing this node
    const g = graphRef.current;
    if (!g) { onClose(); return; }
    let groupId: string | null = null;
    // Derive group from filePath directory (matches transforms.ts group ID pattern)
    const filePath = attrs?.filePath;
    if (filePath) {
      const dir = filePath.split('/').slice(0, -1).join('/') || '/';
      groupId = `group:${dir}`;
    }
    // Fallback: search all group nodes for one containing this nodeId
    if (!groupId || !g.hasNode(groupId)) {
      g.forEachNode((id, a) => {
        if (a.isGroup && a.childNodeIds?.includes(nodeId)) {
          groupId = id;
        }
      });
    }
    if (groupId && g.hasNode(groupId)) {
      useGraphStore.getState().setViewMode('grouped');
      setTimeout(() => {
        useGraphStore.getState().requestLayout();
        setTimeout(() => {
          useGraphStore.getState().selectNode(groupId!);
          useGraphStore.getState().setFocusMode(groupId!);
          useUIStore.getState().setDetailPanelOpen(true);
        }, 100);
      }, 50);
    }
    onClose();
  }

  function handleHideNode() {
    const g = graphRef.current;
    if (g?.hasNode(nodeId)) {
      g.setNodeAttribute(nodeId, 'hidden', true);
    }
    useGraphStore.getState().syncFromGraphology();
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
    onClose();
  }

  function handleCopyName() {
    const label = attrs?.label;
    if (typeof label === 'string') {
      navigator.clipboard.writeText(label);
    }
    onClose();
  }

  const items = [
    { icon: Eye, label: 'View Details', action: handleViewDetails, shortcut: 'Enter' },
    { icon: Crosshair, label: 'Focus on Node', action: handleFocus, shortcut: 'N' },
    ...(isGroup
      ? [{ icon: Layers, label: 'Expand Group', action: handleExpandGroup, shortcut: 'E' }]
      : []),
    ...(!isGroup && viewMode === 'individual'
      ? [{ icon: FolderUp, label: 'Combine Group', action: handleCombineGroup, shortcut: 'G' }]
      : []),
    { icon: Clipboard, label: 'Copy Name', action: handleCopyName, shortcut: '⌘C' },
    { icon: EyeOff, label: 'Hide Node', action: handleHideNode, destructive: true, shortcut: 'Del' },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] rounded-md border bg-popover/95 backdrop-blur-md p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.action}
          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
            'destructive' in item && item.destructive
              ? 'text-destructive hover:text-destructive'
              : ''
          }`}
        >
          <item.icon className="h-4 w-4" />
          <span className="flex-1 text-left">{item.label}</span>
          {'shortcut' in item && item.shortcut && (
            <kbd className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded">
              {item.shortcut}
            </kbd>
          )}
        </button>
      ))}
    </div>
  );
}
