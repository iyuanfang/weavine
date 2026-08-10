import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { isTauri } from '../lib/adapter';

export function useGlobalShortcut(combo: string, cb: () => void) {
  useEffect(() => {
    if (isTauri) {
      // Registered system-wide via tauri-plugin-global-shortcut in Rust (desktop).
      const unlistenP = listen('ctrl-k-pressed', () => cb());
      return () => {
        unlistenP.then((unlisten) => unlisten()).catch(() => {});
      };
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
