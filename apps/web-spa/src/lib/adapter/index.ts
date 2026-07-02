// Public entry for the adapter layer.
//
// The Tauri app uses `new TauriAdapter()`. The web/browser
// build (which doesn't exist yet) would use `new HttpAdapter(...)`
// instead. Both implement the same `PRMAdapter` contract.
//
// We expose a React context + `useAdapter` hook so components
// can do `const adapter = useAdapter()` and never have to know
// which transport is wired up.

import { createContext, useContext } from 'react';
import { QueryClient } from '@tanstack/react-query';

import { TauriAdapter } from './tauri';
import type { PRMAdapter } from './types';

export type { PRMAdapter } from './types';
export {
  TauriAdapter,
  isTauri,
} from './tauri';
export { HttpAdapter } from './http';

export function createWebQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // SQLite-backed local commands are basically free to re-run.
        // 30s feels like a sensible "refetch on tab focus" cadence
        // without being chatty. Tweak in Phase 2 if needed.
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

export function createDefaultAdapter(): PRMAdapter {
  return new TauriAdapter();
}

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
