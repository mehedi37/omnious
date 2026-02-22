'use client';

import { Clipboard, Crosshair, Eye, EyeOff, Layers } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { graphRef, sigmaRef, useGraphStore } from '@/lib/stores/graph-store';
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

  const handleViewDetails = useCallback(() => {
    useGraphStore.getState().selectNode(nodeId);
    useUIStore.getState().setDetailPanelOpen(true);
    onClose();
  }, [nodeId, onClose]);

  const handleFocus = useCallback(() => {
    useGraphStore.getState().setFocusMode(nodeId);
    onClose();
  }, [nodeId, onClose]);

  const handleExpandGroup = useCallback(() => {
    useGraphStore.getState().setViewMode('individual');
    setTimeout(() => useGraphStore.getState().requestLayout(), 50);
    onClose();
  }, [onClose]);

  const handleHideNode = useCallback(() => {
    const g = graphRef.current;
    if (g?.hasNode(nodeId)) {
      g.setNodeAttribute(nodeId, 'hidden', true);
    }
    sigmaRef.current?.refresh();
    useGraphStore.getState().deselectAll();
    useUIStore.getState().setDetailPanelOpen(false);
    onClose();
  }, [nodeId, onClose]);

  const handleCopyName = useCallback(() => {
    const label = attrs?.label;
    if (typeof label === 'string') {
      navigator.clipboard.writeText(label);
    }
    onClose();
  }, [attrs, onClose]);

  const items = useMemo(() => [
    { icon: Eye, label: 'View Details', action: handleViewDetails },
    { icon: Crosshair, label: 'Focus on Node', action: handleFocus },
    ...(isGroup
      ? [{ icon: Layers, label: 'Expand Group', action: handleExpandGroup }]
      : []),
    { icon: Clipboard, label: 'Copy Name', action: handleCopyName },
    { icon: EyeOff, label: 'Hide Node', action: handleHideNode, destructive: true },
  ], [handleViewDetails, handleFocus, isGroup, handleExpandGroup, handleCopyName, handleHideNode]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-md border bg-popover/95 backdrop-blur-md p-1 shadow-lg animate-in fade-in-0 zoom-in-95"
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
          {item.label}
        </button>
      ))}
    </div>
  );
}
