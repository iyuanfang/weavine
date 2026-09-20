import { invoke } from '@tauri-apps/api/core';

import { isTauri } from './index';
import { getAccessToken } from '../auth/storage';
import type { ParsedQuick } from '../quick-types';

const VITE_API_BASE: string = (() => {
  if (typeof import.meta === 'undefined') return '';
  const env = (import.meta as unknown as Record<string, unknown>).env as
    | Record<string, string | undefined>
    | undefined;
  return env?.VITE_API_BASE ?? '';
})();

export async function parseQuick(
  text: string,
  contact_names: string[],
  userId: string,
): Promise<ParsedQuick> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('quick-capture: empty text');

  if (isTauri) {
    return invoke<ParsedQuick>('quick_parse', {
      user_id: userId,
      text: trimmed,
      contact_names,
    });
  }

  const url = VITE_API_BASE.replace(/\/+$/, '') + '/api/quick/parse';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: trimmed, contact_names }),
  });
  if (!resp.ok) {
    let msg = '';
    try {
      msg = await resp.text();
    } catch {
      msg = `HTTP ${resp.status}`;
    }
    throw new Error(`POST /api/quick/parse: ${resp.status} — ${msg}`);
  }
  return resp.json() as Promise<ParsedQuick>;
}