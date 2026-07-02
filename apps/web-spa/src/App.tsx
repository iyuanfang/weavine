import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';

import { AppShell } from './components/AppShell';
import {
  AdapterProvider,
  createDefaultAdapter,
  createWebQueryClient,
  type PRMAdapter,
} from './lib/adapter';

export function App({ children }: { children?: ReactNode }) {
  // One adapter + one query client per app instance. The
  // adapter is a thin wrapper over invoke(); the query
  // client owns the cache. Both are stable references
  // (useMemo with [] deps) so React Query doesn't tear
  // down its cache on every re-render.
  const adapter = useMemo<PRMAdapter>(() => createDefaultAdapter(), []);
  const queryClient = useMemo(() => createWebQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AdapterProvider value={adapter}>
        <AppShell>{children}</AppShell>
      </AdapterProvider>
    </QueryClientProvider>
  );
}
