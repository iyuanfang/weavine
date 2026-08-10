import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';

import { AppShell } from './components/AppShell';
import { QuickCapture } from './components/QuickCapture';
import { QuickFab } from './components/QuickFab';
import { useGlobalShortcut } from './hooks/useGlobalShortcut';
import { RegisterSW } from './lib/register-sw';
import { useReminderPoller } from './lib/use-reminder-poller';
import {
  AdapterProvider,
  createDefaultAdapter,
  createWebQueryClient,
  type PRMAdapter,
} from './lib/adapter';

function ReminderPoller() {
  useReminderPoller();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const adapter = useMemo<PRMAdapter>(() => createDefaultAdapter(), []);
  const queryClient = useMemo(() => createWebQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AdapterProvider value={adapter}>
        {children}
        <RegisterSW />
        <ReminderPoller />
      </AdapterProvider>
    </QueryClientProvider>
  );
}

function AppInner({ children }: { children?: ReactNode }) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickInitial, setQuickInitial] = useState('');
  useGlobalShortcut('k', () => setQuickOpen((o) => !o));
  const openQuick = (initialText: string) => {
    setQuickInitial(initialText);
    setQuickOpen(true);
  };
  return (
    <>
      <AppShell>{children}</AppShell>
      <QuickFab onOpen={openQuick} />
      {quickOpen && (
        <QuickCapture
          onClose={() => setQuickOpen(false)}
          initialText={quickInitial}
        />
      )}
    </>
  );
}

export function App({ children }: { children?: ReactNode }) {
  return (
    <Providers>
      <AppInner>{children}</AppInner>
    </Providers>
  );
}
