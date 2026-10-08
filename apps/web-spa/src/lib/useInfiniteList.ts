import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInfiniteListOptions<T> {
  fetcher: (cursor: string | null) => Promise<{ items: T[]; cursor: string | null; has_more: boolean }>;
  resetTrigger?: unknown;
}

export interface UseInfiniteListResult<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: unknown | null;
  fetchMore: () => Promise<void>;
  reset: () => void;
}

export function useInfiniteList<T>(opts: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
  const { fetcher, resetTrigger } = opts;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  // Refs hold the latest values so callbacks always see up-to-date state
  // without being recreated on every render.
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const inFlightRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const fetchMore = useCallback(async () => {
    if (inFlightRef.current) return;
    if (isLoadingRef.current) return;
    // Allow first fetch regardless of hasMore
    if (cursorRef.current !== null && !hasMoreRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const currentCursor = cursorRef.current;
      const result = await fetcherRef.current(currentCursor);
      setItems((prev) => {
        if (currentCursor === null) return result.items;
        // Dedup: drop items we already have
        const seen = new Set(prev.map((it) => (it as { id?: string }).id ?? ''));
        const fresh = result.items.filter(
          (it) => !seen.has((it as { id?: string }).id ?? ''),
        );
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      cursorRef.current = result.cursor;
      setCursor(result.cursor);
      hasMoreRef.current = result.has_more;
      setHasMore(result.has_more);
    } catch (e) {
      setError(e);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setCursor(null);
    cursorRef.current = null;
    setHasMore(true);
    hasMoreRef.current = true;
    setError(null);
    setIsLoading(false);
    isLoadingRef.current = false;
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    reset();
    // Small delay to avoid double-fetch in React StrictMode
    const id = requestAnimationFrame(() => fetchMore());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTrigger]);

  return { items, cursor, hasMore, isLoading, error, fetchMore, reset };
}

// Hook: sentinel ref for IntersectionObserver + button load-more.
// Attach `sentinelRef` to a 1px div at the bottom of the list.
// When the sentinel enters viewport, calls `fetchMore()`.
// Observer disconnects while loading, reconnects when done.
export function useScrollSentinel(
  fetchMore: () => Promise<void>,
  opts: { enabled: boolean; isLoading: boolean; hasMore: boolean },
) {
  const { enabled, isLoading, hasMore } = opts;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const shouldLoad = enabled && hasMore && !isLoading;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !shouldLoad) {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      return;
    }

    if (observerRef.current) observerRef.current.disconnect();

    // Find the nearest scrollable ancestor (e.g. .app-shell__main)
    let scrollRoot: Element | null = el.parentElement;
    while (scrollRoot && scrollRoot !== document.documentElement) {
      const style = getComputedStyle(scrollRoot);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      scrollRoot = scrollRoot.parentElement;
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchMore();
        }
      },
      { root: scrollRoot, rootMargin: '200px' },
    );
    observerRef.current.observe(el);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [shouldLoad, fetchMore]);

  return sentinelRef;
}
