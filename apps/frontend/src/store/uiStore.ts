import { create } from 'zustand';

type ViewType = 'inbox' | 'settings' | 'analytics' | 'contacts' | 'broadcast';

interface UiState {
  currentView: ViewType;
  isMuted: boolean;
  setCurrentView: (view: ViewType) => void;
  toggleMute: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  currentView: 'inbox',
  isMuted: localStorage.getItem('omni_muted') === 'true',
  setCurrentView: (view) => set({ currentView: view }),
  toggleMute: () => set((state) => {
    const newMuted = !state.isMuted;
    localStorage.setItem('omni_muted', String(newMuted));
    return { isMuted: newMuted };
  })
}));
