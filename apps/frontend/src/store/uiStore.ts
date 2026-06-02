import { create } from 'zustand';

interface UiState {
  isMuted: boolean;
  toggleMute: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isMuted: localStorage.getItem('omni_muted') === 'true',
  toggleMute: () => set((state) => {
    const newMuted = !state.isMuted;
    localStorage.setItem('omni_muted', String(newMuted));
    return { isMuted: newMuted };
  })
}));
