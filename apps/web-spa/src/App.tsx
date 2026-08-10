import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';

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

interface QuickCaptureApi {
  open: (initialText?: string) => void;
}

const QuickCaptureContext = createContext<QuickCaptureApi | null>(null);

export function useQuickCapture(): QuickCaptureApi {
  const ctx = useContext(QuickCaptureContext);
  if (!ctx) throw new Error('useQuickCapture must be used within AppInner');
  return ctx;
}

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

export function AppInner({ children }: { children?: ReactNode }) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickInitial, setQuickInitial] = useState('');
  useGlobalShortcut('k', () => setQuickOpen((o) => !o));
  const openQuick = (initialText: string = '') => {
    setQuickInitial(initialText);
    setQuickOpen(true);
  };
  const quickApi = useMemo<QuickCaptureApi>(() => ({ open: openQuick }), []);
  return (
    <QuickCaptureContext.Provider value={quickApi}>
      {children}
      <QuickFab onOpen={openQuick} />
      {quickOpen && (
        <QuickCapture
          onClose={() => setQuickOpen(false)}
          initialText={quickInitial}
        />
      )}
    </QuickCaptureContext.Provider>
  );
}

export function App({ children }: { children?: ReactNode }) {
  return (
    <Providers>
      <AppInner>{children}</AppInner>
    </Providers>
  );
}
