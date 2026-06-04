import { useEffect, useCallback } from 'react';

export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: (e: KeyboardEvent) => void;
  description: string;
  category: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[], enabled = true) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Abaikan jika user sedang di input/textarea (kecuali untuk Ctrl/Alt combinations)
    const target = e.target as HTMLElement;
    const isInInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;

    for (const shortcut of shortcuts) {
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = !!shortcut.ctrl === (e.ctrlKey || e.metaKey); // Support Cmd on Mac
      const shiftMatch = !!shortcut.shift === e.shiftKey;
      const altMatch = !!shortcut.alt === e.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        // Jika shortcut membutuhkan modifier (ctrl/alt), izinkan bahkan di input
        // Jika tidak ada modifier, block saat di input
        if (!shortcut.ctrl && !shortcut.alt && isInInput && e.key !== 'Escape') continue;

        e.preventDefault();
        shortcut.action(e);
        return;
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}