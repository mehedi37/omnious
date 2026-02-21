import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface WorkspaceState {
  currentWorkspaceId: string | null;
  currentWorkspaceSlug: string | null;
  currentProjectId: string | null;
  currentProjectSlug: string | null;

  // Actions
  setCurrentWorkspace: (id: string, slug: string) => void;
  setCurrentProject: (id: string, slug: string) => void;
  clearWorkspace: () => void;
  clearProject: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      currentWorkspaceSlug: null,
      currentProjectId: null,
      currentProjectSlug: null,

      setCurrentWorkspace: (id, slug) =>
        set({
          currentWorkspaceId: id,
          currentWorkspaceSlug: slug,
          // Clear project when switching workspace
          currentProjectId: null,
          currentProjectSlug: null,
        }),

      setCurrentProject: (id, slug) =>
        set({
          currentProjectId: id,
          currentProjectSlug: slug,
        }),

      clearWorkspace: () =>
        set({
          currentWorkspaceId: null,
          currentWorkspaceSlug: null,
          currentProjectId: null,
          currentProjectSlug: null,
        }),

      clearProject: () =>
        set({
          currentProjectId: null,
          currentProjectSlug: null,
        }),
    }),
    {
      name: 'omnious-workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentWorkspaceId: state.currentWorkspaceId,
        currentWorkspaceSlug: state.currentWorkspaceSlug,
        currentProjectId: state.currentProjectId,
        currentProjectSlug: state.currentProjectSlug,
      }),
    },
  ),
);
