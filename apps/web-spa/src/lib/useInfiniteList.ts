import { useEffect, useState } from 'react';

export interface UseInfiniteListOptions<T> {
  fetcher: (cursor: string | null) => Promise<{ items: T[]; cursor: string | null; has_more: boolean }>;
  resetTrigger?: unknown;
}

export function useInfiniteList<T>(opts: UseInfiniteListOptions<T>) {
  const { fetcher, resetTrigger } = opts;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const fetchMore = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher(cursor);
      setItems((prev) => (cursor === null ? result.items : [...prev, ...result.items]));
      setCursor(result.cursor);
      setHasMore(result.has_more);
    } catch (e) {
      setError(e);
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setIsLoading(false);
  };

  useEffect(() => {
    reset();
    fetchMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTrigger]);

  return { items, cursor, hasMore, isLoading, error, fetchMore, reset };
}
