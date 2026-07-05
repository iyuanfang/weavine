// Auth hooks — single-user desktop model.
//
// `getLocalUser()` is the only auth call. There's no login
// flow: the Tauri app boots, the Rust side seeds a `User`
// row with `isLocal=1`, and we cache it via TanStack Query.
// Every data hook then derives `ownerId` from this query.

import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../adapter';

export const localUserQueryKey = ['local-user'] as const;

export function useLocalUser() {
  const adapter = useAdapter();
  return useQuery({
    queryKey: localUserQueryKey,
    queryFn: () => adapter.getLocalUser(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Convenience hook: returns the current owner id, or
 * `null` while the query is loading or if it failed.
 *
 * Use this for `useQuery({ enabled: !!ownerId, ... })`
 * guards in feature hooks.
 */
export function useOwnerId(): string | null {
  const { data } = useLocalUser();
  return data?.id ?? null;
}

/**
 * Convenience hook: returns true once the local user is
 * known. Use this to gate routes that need a logged-in
 * user, or to show a splash screen while we wait.
 */
export function useIsAuthed(): boolean {
  const { data, isLoading, isError } = useLocalUser();
  if (isLoading || isError) return false;
  return Boolean(data?.id);
}
