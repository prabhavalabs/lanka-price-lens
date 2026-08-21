import { create } from "zustand";

type UiState = {
  navigationCollapsed: boolean;
  navigationOpen: boolean;
  toggleNavigationCollapsed: () => void;
  setNavigationOpen: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  navigationCollapsed: false,
  navigationOpen: false,
  toggleNavigationCollapsed: () => set((state) => ({ navigationCollapsed: !state.navigationCollapsed })),
  setNavigationOpen: (navigationOpen) => set({ navigationOpen }),
}));
