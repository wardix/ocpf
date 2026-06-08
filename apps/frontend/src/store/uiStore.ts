import { create } from 'zustand';

export type MobileView = 'sidebar' | 'chat' | 'contacts' | 'settings';

interface UiState {
  isMuted: boolean;
  toggleMute: () => void;
  activeView: MobileView;
  setActiveView: (view: MobileView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isMuted: localStorage.getItem('omni_muted') === 'true',
  toggleMute: () => set((state) => {
    const newMuted = !state.isMuted;
    localStorage.setItem('omni_muted', String(newMuted));
    return { isMuted: newMuted };
  }),
  activeView: 'sidebar',
  setActiveView: (view) => set({ activeView: view })
}));
