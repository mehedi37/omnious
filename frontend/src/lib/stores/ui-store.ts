import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  detailPanelOpen: boolean;
  activeDetailTab: 'details' | 'code' | 'ai';
  pendingReplayTraceId: string | null;
  filtersOpen: boolean;
  keyboardShortcutsOpen: boolean;
  minimapVisible: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  setActiveDetailTab: (tab: UIState['activeDetailTab']) => void;
  setPendingReplayTraceId: (traceId: string | null) => void;
  toggleFilters: () => void;
  setFiltersOpen: (open: boolean) => void;
  toggleKeyboardShortcuts: () => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;
  toggleMinimap: () => void;
  setMinimapVisible: (visible: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  detailPanelOpen: true,
  activeDetailTab: 'details',
  pendingReplayTraceId: null,
  filtersOpen: false,
  keyboardShortcutsOpen: false,
  minimapVisible: true,

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  openCommandPalette: () => set({ commandPaletteOpen: true }),

  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),

  setActiveDetailTab: (tab) => set({ activeDetailTab: tab, detailPanelOpen: true }),

  setPendingReplayTraceId: (traceId) => set({ pendingReplayTraceId: traceId }),

  toggleFilters: () => set((state) => ({ filtersOpen: !state.filtersOpen })),

  setFiltersOpen: (open) => set({ filtersOpen: open }),

  toggleKeyboardShortcuts: () =>
    set((state) => ({ keyboardShortcutsOpen: !state.keyboardShortcutsOpen })),

  setKeyboardShortcutsOpen: (open) => set({ keyboardShortcutsOpen: open }),

  toggleMinimap: () => set((state) => ({ minimapVisible: !state.minimapVisible })),

  setMinimapVisible: (visible) => set({ minimapVisible: visible }),
}));
