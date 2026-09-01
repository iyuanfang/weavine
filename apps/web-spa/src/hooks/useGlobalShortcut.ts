import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';

import { isTauri } from '../lib/adapter';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useGlobalShortcut(combo: string, cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  // Parse the combo. Supported forms:
  //   "ctrl+k"        — Ctrl/⌘ required
  //   "ctrl+shift+k"  — Ctrl/⌘ + Shift
  //   "k" / "\\"      — bare key, no modifier (skipped when focus is in a typing target)
  const requireCtrl = /^ctrl\+/i.test(combo);
  const requireShift = /^ctrl\+shift\+/i.test(combo);
  const key = combo
    .toLowerCase()
    .replace(/^ctrl\+shift\+/, '')
    .replace(/^ctrl\+/, '');

  useEffect(() => {
    if (isTauri) {
      const unlistenP = listen('ctrl-k-pressed', () => cbRef.current());
      return () => {
        unlistenP.then((unlisten) => unlisten()).catch(() => {});
      };
    }
    const handler = (e: KeyboardEvent) => {
      if (requireCtrl && !(e.ctrlKey || e.metaKey)) return;
      if (requireShift && !e.shiftKey) return;
      if (e.key.toLowerCase() !== key) return;
      // Bare-key shortcuts must not eat the keypress while the user is
      // typing into an input / textarea / contentEditable — otherwise they
      // can never type `\` into a note body. Modifier combos don't need
      // this guard because Ctrl+K etc. don't insert characters.
      if (!requireCtrl && isTypingTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      cbRef.current();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [combo]);
}
