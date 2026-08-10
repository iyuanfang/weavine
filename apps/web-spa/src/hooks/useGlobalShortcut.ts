import { useEffect } from 'react';

import { isTauri } from '../lib/adapter';

export function useGlobalShortcut(combo: string, cb: () => void) {
  useEffect(() => {
    if (isTauri) {
      // Tauri path registered via tauri-plugin-global-shortcut (Task 8)
      return;
    }
    const key = combo.toLowerCase().replace('ctrl+', '');
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key) {
        e.preventDefault();
        cb();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [combo, cb]);
}