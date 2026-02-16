import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  detailPanelOpen: boolean;
  activeDetailTab: 'properties' | 'code' | 'errors' | 'traces';

  // Actions
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  setActiveDetailTab: (tab: UIState['activeDetailTab']) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  detailPanelOpen: false,
  activeDetailTab: 'properties',

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  openCommandPalette: () =>
    set({ commandPaletteOpen: true }),

  closeCommandPalette: () =>
    set({ commandPaletteOpen: false }),

  setDetailPanelOpen: (open) =>
    set({ detailPanelOpen: open }),

  setActiveDetailTab: (tab) =>
    set({ activeDetailTab: tab, detailPanelOpen: true }),
}));
