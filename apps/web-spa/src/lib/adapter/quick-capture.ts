import { invoke } from '@tauri-apps/api/core';

import { isTauri } from './index';
import type { ParsedQuick } from '../quick-types';
import { parseQuick as parseQuickLocal } from '../quick/parse';

export async function parseQuick(
  text: string,
  contact_names: string[],
  userId: string,
): Promise<ParsedQuick> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('quick-capture: empty text');

  // Tauri: native parser, runs in-process. Single source of truth lives in
  // `src-tauri/src/quick.rs`.
  if (isTauri) {
    return invoke<ParsedQuick>('quick_parse', {
      user_id: userId,
      text: trimmed,
      contact_names,
    });
  }

  // Browser / wap: parse locally so every onChange does NOT round-trip
  // through /api/quick/parse. The mirror lives in
  // `apps/web-spa/src/lib/quick/parse.ts` and is unit-tested to stay
  // aligned with the Rust counterpart. Server endpoint is kept for parity
  // / future remote use; we don't call it from the keystroke path anymore.
  void contact_names; // browser parser takes resolved contact objects, not names
  void userId; // unused on local path
  return parseQuickLocal(trimmed);
}