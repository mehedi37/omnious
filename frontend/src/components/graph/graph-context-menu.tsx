'use client';

import {
  AlertTriangle,
  BotMessageSquare,
  Copy,
  Crosshair,
  Expand,
  EyeOff,
  Flame,
  Info,
  Map,
  Maximize,
  MessageSquareDot,
  Route,
  RotateCcw,
} from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useAIStore } from '@/lib/stores/ai-store';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MenuPosition {
  x: number;
  y: number;
}

interface ContextMenuState {
  type: 'node' | 'pane';
  position: MenuPosition;
  nodeId?: string;
  nodeName?: string;
}

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}

// ─── Menu item component ─────────────────────────────────────────────────────

function MenuItem({ icon: Icon, label, shortcut, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:bg-accent focus-visible:outline-none',
        danger && 'text-destructive hover:text-destructive',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <kbd className="ml-auto text-[10px] tracking-widest text-muted-foreground opacity-60">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

// ─── Main context menu hook ──────────────────────────────────────────────────

export function useGraphContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Viewport-aware position adjustment
  const adjustPosition = useCallback((x: number, y: number): MenuPosition => {
    const menuEl = menuRef.current;
    if (!menuEl) return { x, y };

    const rect = menuEl.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Flip left if overflows right
    if (x + rect.width > viewW - 8) {
      adjustedX = x - rect.width;
    }
    // Flip up if overflows bottom
    if (y + rect.height > viewH - 8) {
      adjustedY = y - rect.height;
    }
    // Clamp to viewport edges
    adjustedX = Math.max(8, adjustedX);
    adjustedY = Math.max(8, adjustedY);

    return { x: adjustedX, y: adjustedY };
  }, []);

  // Reposition after first render (when we know the menu dimensions)
  const [adjustedPos, setAdjustedPos] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (menu && menuRef.current) {
      const pos = adjustPosition(menu.position.x, menu.position.y);
      setAdjustedPos(pos);
    } else {
      setAdjustedPos(null);
    }
  }, [menu, adjustPosition]);

  // Close on outside click, Escape, scroll
  useEffect(() => {
    if (!menu) return;

    function handleClose() {
      setMenu(null);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(null);
      }
    }

    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }

    // Delay to avoid the same right-click closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown, { once: false });
    }, 0);

    window.addEventListener('keydown', handleKeyDown);
    // Close on scroll inside React Flow
    const rfContainer = containerRef.current;
    if (rfContainer) {
      rfContainer.addEventListener('scroll', handleClose, { passive: true });
    }

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      rfContainer?.removeEventListener('scroll', handleClose);
    };
  }, [menu]);

  // Close menu helper
  const close = useCallback(() => setMenu(null), []);

  // ── Node context menu actions ──────────────────────────────────────────────

  const handleFocus = useCallback(() => {
    if (!menu?.nodeId) return;
    const gs = useGraphStore.getState();
    if (gs.focusedNodeId === menu.nodeId) {
      gs.clearFocusMode();
    } else {
      gs.setFocusMode(menu.nodeId);
    }
    window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
    close();
  }, [menu?.nodeId, close]);

  const handleExpandDeps = useCallback(() => {
    if (!menu?.nodeId) return;
    window.dispatchEvent(
      new CustomEvent('omnious:expand-deps', {
        detail: { nodeId: menu.nodeId, nodeName: menu.nodeName },
      }),
    );
    close();
  }, [menu?.nodeId, menu?.nodeName, close]);

  const handleShowErrors = useCallback(() => {
    if (!menu?.nodeId) return;
    useGraphStore.getState().selectNode(menu.nodeId);
    useUIStore.getState().setActiveDetailTab('details');
    close();
  }, [menu?.nodeId, close]);

  const handleViewDetails = useCallback(() => {
    if (!menu?.nodeId) return;
    useGraphStore.getState().selectNode(menu.nodeId);
    useGraphStore.getState().highlightConnectedEdges(menu.nodeId);
    useUIStore.getState().setActiveDetailTab('details');
    close();
  }, [menu?.nodeId, close]);

  const handleAskAI = useCallback(() => {
    // Pre-fill AI chat with "Explain #NodeName"
    if (menu?.nodeName) {
      useAIStore.getState().setPrefillMessage(`Explain #${menu.nodeName}`);
      useUIStore.getState().setActiveDetailTab('ai');
    }
    close();
  }, [menu?.nodeName, close]);

  const handleAskThisNode = useCallback(() => {
    if (!menu?.nodeName || !menu.nodeId) return;
    // Select the node so Inspector has context, then prompt AI in first person
    useGraphStore.getState().selectNode(menu.nodeId);
    useAIStore.getState().setPrefillMessage(
      `You are \`${menu.nodeName}\`. Describe yourself in first person: what you do, who calls you, your key dependencies, and any known failure patterns.`,
    );
    useUIStore.getState().setActiveDetailTab('ai');
    close();
  }, [menu?.nodeName, menu?.nodeId, close]);

  const handleCopyName = useCallback(() => {
    if (menu?.nodeName) {
      navigator.clipboard.writeText(menu.nodeName).then(() => {
        toast.success(`Copied "${menu.nodeName}" to clipboard`);
      });
    }
    close();
  }, [menu?.nodeName, close]);

  const handleHideNode = useCallback(() => {
    if (!menu?.nodeId) return;
    const node = useGraphStore.getState().nodes.find((n) => n.id === menu.nodeId);
    if (node) {
      useGraphStore.getState().toggleNodeTypeFilter(node.data.oirType);
    }
    close();
  }, [menu?.nodeId, close]);

  const handleTraceErrorPath = useCallback(() => {
    if (!menu?.nodeId) return;
    const gs = useGraphStore.getState();
    if (gs.errorFlowNodeIds.size > 0) {
      gs.clearErrorPath();
    } else {
      gs.traceErrorPath(menu.nodeId);
    }
    close();
  }, [menu?.nodeId, close]);

  // ── Pane context menu actions ──────────────────────────────────────────────

  const handleFitView = useCallback(() => {
    window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
    close();
  }, [close]);

  const handleResetView = useCallback(() => {
    useGraphStore.getState().clearFocusMode();
    window.dispatchEvent(new CustomEvent('omnious:focus-fit'));
    close();
  }, [close]);

  const handleToggleHeatmap = useCallback(() => {
    useGraphStore.getState().toggleHeatmap();
    close();
  }, [close]);

  const handleToggleMinimap = useCallback(() => {
    useUIStore.getState().toggleMinimap();
    close();
  }, [close]);

  // ── Public API (called from react-flow-canvas) ────────────────────────────

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: { id: string; data: { label?: string } }) => {
      event.preventDefault();
      event.stopPropagation();
      setMenu({
        type: 'node',
        position: { x: event.clientX, y: event.clientY },
        nodeId: node.id,
        nodeName: (node.data as { label?: string }).label ?? 'Node',
      });
    },
    [],
  );

  const onPaneContextMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    setMenu({
      type: 'pane',
      position: { x: event.clientX, y: event.clientY },
    });
  }, []);

  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const focusedNodeId = useGraphStore((s) => s.focusedNodeId);
  const errorFlowActive = useGraphStore((s) => s.errorFlowNodeIds.size > 0);
  const minimapVisible = useUIStore((s) => s.minimapVisible);
  const isNodeFocused = menu?.nodeId ? focusedNodeId === menu.nodeId : false;

  const pos = adjustedPos ?? menu?.position;

  return {
    onNodeContextMenu,
    onPaneContextMenu,
    setContainerRef,
    menuElement: menu ? (
      <div
        ref={menuRef}
        className={cn(
          'fixed z-9999 min-w-50 rounded-md border bg-popover p-1 shadow-lg',
          'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
        )}
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
        }}
      >
        {menu.type === 'node' ? (
          <>
            {/* Node header */}
            <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground truncate max-w-55">
              {menu.nodeName}
            </div>
            <MenuSeparator />
            <MenuItem
              icon={Crosshair}
              label={isNodeFocused ? 'Exit Focus' : 'Focus (2-hop)'}
              shortcut="N"
              onClick={handleFocus}
            />
            <MenuItem
              icon={Expand}
              label="Expand Dependencies"
              shortcut="E"
              onClick={handleExpandDeps}
            />
            <MenuSeparator />
            <MenuItem icon={Info} label="View Details" onClick={handleViewDetails} />
            <MenuItem icon={AlertTriangle} label="Show Errors" onClick={handleShowErrors} />
            <MenuItem icon={Route} label={errorFlowActive ? 'Clear Error Path' : 'Trace Error Path'} onClick={handleTraceErrorPath} />
            <MenuItem icon={BotMessageSquare} label="Ask AI About This" onClick={handleAskAI} />
            <MenuItem icon={MessageSquareDot} label="Ask This Node" onClick={handleAskThisNode} />
            <MenuItem icon={Copy} label="Copy Name" shortcut="Ctrl+C" onClick={handleCopyName} />
            <MenuSeparator />
            <MenuItem icon={EyeOff} label="Hide Node Type" shortcut="H" onClick={handleHideNode} />
          </>
        ) : (
          <>
            <MenuItem icon={Maximize} label="Fit View" shortcut="F" onClick={handleFitView} />
            <MenuItem
              icon={RotateCcw}
              label="Reset to Overview"
              shortcut="0"
              onClick={handleResetView}
            />
            <MenuSeparator />
            <MenuItem
              icon={Flame}
              label="Toggle Error Heatmap"
              shortcut="Shift+H"
              onClick={handleToggleHeatmap}
            />
            <MenuItem
              icon={Map}
              label={minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
              shortcut="M"
              onClick={handleToggleMinimap}
            />
          </>
        )}
      </div>
    ) : null,
  };
}
