import { create } from 'zustand';

const THEME_KEY = 'omnichannel-theme';
const THEMES = ['light', 'dark', 'corporate'] as const;
type Theme = typeof THEMES[number];

interface ThemeState {
  theme: Theme;
  themes: readonly Theme[];
  setTheme: (newTheme: Theme) => void;
  cycleTheme: () => void;
}

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  
  const saved = localStorage.getItem(THEME_KEY) as Theme;
  if (saved && THEMES.includes(saved)) return saved;

  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  themes: THEMES,
  setTheme: (newTheme: Theme) => {
    localStorage.setItem(THEME_KEY, newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    set({ theme: newTheme });
  },
  cycleTheme: () => {
    const { theme, themes, setTheme } = get();
    const idx = themes.indexOf(theme);
    const nextTheme = themes[(idx + 1) % themes.length];
    setTheme(nextTheme);
  }
}));
