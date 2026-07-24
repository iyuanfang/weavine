// Public entry for the adapter layer.
//
// `createAdapter()` returns a lazy singleton PRMAdapter:
//   - TauriAdapter  when running inside the Tauri shell (desktop/mobile)
//   - HttpAdapter   when running in a plain browser
//
// Both implement the same PRMAdapter contract so downstream
// code is environment-agnostic.

import { createContext, useContext } from 'react';
import { QueryClient } from '@tanstack/react-query';

import { TauriAdapter, isTauri } from './tauri';
import { HttpAdapter } from './http';
import type { PRMAdapter } from './types';

export type { PRMAdapter } from './types';
export {
  TauriAdapter,
  HttpAdapter,
  isTauri,
};

// ── Lazy singleton ─────────────────────────────────────

let _adapter: PRMAdapter | null = null;

export function createAdapter(): PRMAdapter {
  if (_adapter) return _adapter;

  _adapter = isTauri
    ? new TauriAdapter()
    : new HttpAdapter();

  return _adapter;
}

/** Ready-to-use singleton instance. Auto-detects Tauri vs browser. */
export const adapter = createAdapter();

/** @deprecated use `createAdapter()` or the exported `adapter` singleton instead. */
export const createDefaultAdapter = createAdapter;

// ── React context (for component-level injection) ──────

const AdapterContext = createContext<PRMAdapter | null>(null);
export const AdapterProvider = AdapterContext.Provider;

export function useAdapter(): PRMAdapter {
  const adapter = useContext(AdapterContext);
  if (!adapter) {
    throw new Error(
      'useAdapter: no <AdapterProvider> in the tree. ' +
        'Wrap your app in <AdapterProvider value={...}>.',
    );
  }
  return adapter;
}

// ── Query client factory ───────────────────────────────

export function createWebQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}
