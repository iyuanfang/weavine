import { QueryClientProvider } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { QuickCapture } from './components/QuickCapture';
import { QuickFab } from './components/QuickFab';
import { SearchPalette } from './components/SearchPalette';
import { ReminderToastContainer, type ReminderToastItem } from './components/ReminderToast';
import { useGlobalShortcut } from './hooks/useGlobalShortcut';
import { RegisterSW } from './lib/register-sw';
import { useReminderPoller } from './lib/use-reminder-poller';

import {
  AdapterProvider,
  createDefaultAdapter,
  createWebQueryClient,
  useAdapter,
  type PRMAdapter,
} from './lib/adapter';
import type { Reminder } from './lib/adapter/types';

interface QuickCaptureApi {
  open: (initialText?: string) => void;
}

const QuickCaptureContext = createContext<QuickCaptureApi | null>(null);

export function useQuickCapture(): QuickCaptureApi {
  const ctx = useContext(QuickCaptureContext);
  if (!ctx) throw new Error('useQuickCapture must be used within AppInner');
  return ctx;
}

interface GlobalSearchApi {
  open: (initialQuery?: string) => void;
  close: () => void;
}

const SearchContext = createContext<GlobalSearchApi | null>(null);

export function useGlobalSearch(): GlobalSearchApi {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useGlobalSearch must be used within AppInner');
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
  const adapter = useAdapter();
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickInitial, setQuickInitial] = useState('');
  const [pendingReminders, setPendingReminders] = useState<ReminderToastItem[]>([]);
  const seenReminderIds = useRef<Set<string>>(new Set());
  useGlobalShortcut('k', () => setQuickOpen((o) => !o));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitial, setSearchInitial] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const openSearch = (initialQuery: string = '') => {
    setSearchInitial(initialQuery);
    setSearchOpen(true);
  };
  const closeSearch = () => setSearchOpen(false);
  const searchApi = useMemo<GlobalSearchApi>(
    () => ({ open: openSearch, close: closeSearch }),
    [],
  );
  const openQuick = (initialText: string = '') => {
    setQuickInitial(initialText);
    setQuickOpen(true);
  };
  const quickApi = useMemo<QuickCaptureApi>(() => ({ open: openQuick }), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const r = (e as CustomEvent<Reminder>).detail;
      if (!r || !r.id) return;
      if (seenReminderIds.current.has(r.id)) return;
      seenReminderIds.current.add(r.id);
      const title =
        r.kind === 'event' ? '日程提醒' : r.kind === 'action' ? '待办提醒' : '提醒';
      setPendingReminders((prev) => [
        ...prev,
        {
          id: r.id,
          title,
          body: r.contact_nickname ?? undefined,
          trigger_at: r.trigger_at,
        },
      ]);
    };
    window.addEventListener('weavine:reminder', handler);
    return () => window.removeEventListener('weavine:reminder', handler);
  }, []);

  // §11.7 cold-start argv: single-instance plugin emits when OS forwards a file.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const mod = await import('@tauri-apps/api/event').catch(() => null);
        if (!mod) return;
        const off = await mod.listen<string>('open-md-from-argv', (ev) => {
          if (typeof ev.payload !== 'string' || !ev.payload) return;
          const url = `/md-editor?path=${encodeURIComponent(ev.payload)}`;
          window.history.pushState({}, '', url);
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        if (cancelled) {
          off();
        } else {
          unlisten = off;
        }
      } catch {
        // Web fallback: silent
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const dismissReminder = useCallback(
    (id: string) => {
      setPendingReminders((prev) => prev.filter((r) => r.id !== id));
      adapter.reminders.dismiss(id).catch(() => {});
    },
    [adapter],
  );

  return (
    <QuickCaptureContext.Provider value={quickApi}>
      <SearchContext.Provider value={searchApi}>
        {children}
        <QuickFab onOpen={openQuick} />
        <ReminderToastContainer reminders={pendingReminders} onDismiss={dismissReminder} />
        {quickOpen && (
          <QuickCapture
            onClose={() => setQuickOpen(false)}
            initialText={quickInitial}
          />
        )}
        {searchOpen && (
          <SearchPalette
            open={searchOpen}
            onClose={closeSearch}
            initialQuery={searchInitial}
          />
        )}
      </SearchContext.Provider>
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
