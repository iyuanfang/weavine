// Public entry for the adapter layer.
//
// `createAdapter()` returns a lazy singleton PRMAdapter:
//   - TauriAdapter  when running inside the Tauri shell (desktop/mobile)
//   - HttpAdapter   when running in a plain browser
//
// Both implement the same PRMAdapter contract so downstream
// code is environment-agnostic.

import { createContext, useContext } from 'react';
import { MutationCache, QueryClient } from '@tanstack/react-query';

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

  return _adapter!;
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

// ── Write-triggered sync ───────────────────────────────

/**
 * How long to wait after the last local write before nudging the sync thread.
 *
 * Short enough that a change is normally on the server before the user picks
 * up their other device; long enough that a bulk action (which fires dozens of
 * mutations) collapses into a single nudge.
 */
const SYNC_NUDGE_DEBOUNCE_MS = 2_000;

let syncNudgeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ask the shell to sync soon, because something was just written locally.
 *
 * The background sync thread otherwise only wakes on its own 30-minute timer,
 * so a change can sit on the device that long before it is even uploaded — and
 * another device then waits its own interval after that. This closes the front
 * half of that gap: the upload starts within seconds.
 *
 * Best-effort by design. An unreachable server is not a failed write — the
 * periodic cycle still picks the change up, and surfacing an error here would
 * make a successful save look broken.
 *
 * The browser adapter writes straight to the server over HTTP and has no local
 * database to sync, so this does nothing there.
 */
function scheduleSyncNudge(): void {
  if (!isTauri) return;

  if (syncNudgeTimer !== null) clearTimeout(syncNudgeTimer);
  syncNudgeTimer = setTimeout(() => {
    syncNudgeTimer = null;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('cloud_request_sync'))
      .catch(() => {
        // Best-effort — the periodic sync still runs.
      });
  }, SYNC_NUDGE_DEBOUNCE_MS);
}

// ── Query client factory ───────────────────────────────

export function createWebQueryClient(): QueryClient {
  return new QueryClient({
    // Every write the app makes goes through a mutation, so hooking the cache
    // once covers all of them — nothing to wire up per call site, and nothing
    // to forget when a new mutation is added.
    mutationCache: new MutationCache({
      onSuccess: () => scheduleSyncNudge(),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}
