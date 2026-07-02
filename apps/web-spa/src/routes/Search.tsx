import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function SearchPage() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  const searchQuery = useQuery({
    queryKey: ['search', ownerId, debouncedQuery],
    queryFn: () => adapter.search.query(ownerId!, debouncedQuery),
    enabled: !!ownerId && debouncedQuery.length > 0,
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (searchQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">搜索失败: {String(searchQuery.error)}</div>
      </div>
    );
  }

  const results = searchQuery.data;
  const hasResults =
    results &&
    (results.contacts.length > 0 ||
      results.interactions.length > 0 ||
      results.events.length > 0 ||
      results.actions.length > 0);

  return (
    <div className="today-page">
      <h1>搜索</h1>

      <input
        type="text"
        placeholder="输入关键词开始搜索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 14,
          marginBottom: 16,
          background: '#fff',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {!query.trim() ? (
        <div className="empty-state">
          <p>输入关键词开始搜索</p>
        </div>
      ) : searchQuery.isLoading ? (
        <div className="loading">…</div>
      ) : hasResults ? (
        <div className="space-y-6">
          {results.contacts.length > 0 && (
            <Section
              title="联系人"
              viewAllHref="/contacts"
              items={results.contacts.map((c) => ({
                key: c.id,
                href: `/contacts/${c.id}`,
                title: c.nickname,
                meta: c.company ?? '',
              }))}
            />
          )}

          {results.interactions.length > 0 && (
            <Section
              title="互动"
              viewAllHref="/contacts"
              items={results.interactions.map((i) => ({
                key: i.id,
                href: `/interactions/${i.id}`,
                title: i.summary,
                meta: (() => {
                  const d = new Date(i.occurred_at);
                  return d.toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  });
                })(),
              }))}
            />
          )}

          {results.events.length > 0 && (
            <Section
              title="日程"
              viewAllHref="/calendar"
              items={results.events.map((e) => ({
                key: e.id,
                href: `/events/${e.id}`,
                title: e.title,
                meta: (() => {
                  const d = new Date(e.start_at);
                  return d.toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  });
                })(),
              }))}
            />
          )}

          {results.actions.length > 0 && (
            <Section
              title="待办"
              viewAllHref="/actions"
              items={results.actions.map((a) => ({
                key: a.id,
                href: `/actions/${a.id}`,
                title: a.title,
                meta: a.due_at
                  ? (() => {
                      const d = new Date(a.due_at);
                      return d.toLocaleDateString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                      });
                    })()
                  : '',
              }))}
            />
          )}
        </div>
      ) : (
        <div className="empty-state">
          <p>未找到匹配的结果</p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  viewAllHref,
  items,
}: {
  title: string;
  viewAllHref: string;
  items: { key: string; href: string; title: string; meta: string }[];
}) {
  return (
    <section className="section">
      <div className="section__header">
        <h2 className="section__title">{title}</h2>
        <Link to={viewAllHref} className="section__view-all">
          全部 →
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            className="row-card"
            style={{ textDecoration: 'none' }}
          >
            <span className="row-card__title">{item.title}</span>
            {item.meta && <span className="row-card__meta">{item.meta}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
