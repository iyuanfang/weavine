import { useCallback, useEffect, useState } from 'react';

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
  const [hasFetched, setHasFetched] = useState(false);

  const fetchMore = useCallback(async () => {
    if (isLoading) return;
    if (hasFetched && !hasMore) return;
    setIsLoading(true);
    setError(null);
    try {
      const currentCursor = cursor;
      const result = await fetcher(currentCursor);
      setItems((prev) =>
        currentCursor === null ? result.items : [...prev, ...result.items],
      );
      setCursor(result.cursor);
      setHasMore(result.has_more);
      setHasFetched(true);
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, isLoading, hasFetched, hasMore, cursor]);

  const reset = useCallback(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setError(null);
    setIsLoading(false);
    setHasFetched(false);
  }, []);

  useEffect(() => {
    reset();
    fetchMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTrigger]);

  return { items, cursor, hasMore, isLoading, error, fetchMore, reset };
}