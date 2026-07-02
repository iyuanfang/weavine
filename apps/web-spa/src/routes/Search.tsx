import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
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

const SECTION_ICONS: Record<string, string> = {
  联系人: '👥',
  互动: '💬',
  日程: '📅',
  待办: '📌',
};

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
      <div className="page">
        <div className="error-banner">搜索失败: {String(searchQuery.error)}</div>
      </div>
    );
  }

  const results = searchQuery.data;
  const contacts = results?.contacts ?? [];
  const interactions = results?.interactions ?? [];
  const events = results?.events ?? [];
  const actions = results?.actions ?? [];
  const totalCount = contacts.length + interactions.length + events.length + actions.length;

  return (
    <div className="page">
      <PageHeader
        title="搜索"
        subtitle={
          debouncedQuery && results
            ? `「${debouncedQuery}」共 ${totalCount} 条结果`
            : '跨联系人、互动、日程、待办'
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          type="text"
          className="input-base"
          placeholder="输入关键词开始搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {!query.trim() ? (
        <div className="empty-state">
          <h3 className="empty-state__title">想找什么？</h3>
          <p className="empty-state__hint">试试人名、公司、互动摘要或日程标题</p>
        </div>
      ) : searchQuery.isLoading ? (
        <div className="loading">搜索中</div>
      ) : totalCount > 0 ? (
        <div style={{ display: 'grid', gap: 24 }}>
          {contacts.length > 0 && (
            <SearchSection
              title="联系人"
              viewAllHref="/contacts"
              items={contacts.map((c) => ({
                key: c.id,
                href: `/contacts/${c.id}`,
                title: c.nickname,
                meta: c.company ?? '',
              }))}
            />
          )}
          {interactions.length > 0 && (
            <SearchSection
              title="互动"
              viewAllHref="/contacts"
              items={interactions.map((i) => ({
                key: i.id,
                href: `/interactions/${i.id}`,
                title: i.summary,
                meta: new Date(i.occurred_at).toLocaleDateString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                }),
              }))}
            />
          )}
          {events.length > 0 && (
            <SearchSection
              title="日程"
              viewAllHref="/calendar"
              items={events.map((e) => ({
                key: e.id,
                href: `/events/${e.id}`,
                title: e.title,
                meta: new Date(e.start_at).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }),
              }))}
            />
          )}
          {actions.length > 0 && (
            <SearchSection
              title="待办"
              viewAllHref="/actions"
              items={actions.map((a) => ({
                key: a.id,
                href: `/actions/${a.id}`,
                title: a.title,
                meta: a.due_at
                  ? new Date(a.due_at).toLocaleDateString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                    })
                  : '',
              }))}
            />
          )}
        </div>
      ) : (
        <div className="empty-state">
          <h3 className="empty-state__title">未找到匹配的结果</h3>
          <p className="empty-state__hint">试试换个关键词</p>
        </div>
      )}
    </div>
  );
}

function SearchSection({
  title,
  viewAllHref,
  items,
}: {
  title: string;
  viewAllHref: string;
  items: { key: string; href: string; title: string; meta: string }[];
}) {
  return (
    <section className="section" style={{ marginBottom: 0 }}>
      <div className="section__header">
        <h2 className="section__title">
          {SECTION_ICONS[title] ?? '·'} {title}
        </h2>
        <Link to={viewAllHref} className="section__view-all">
          全部 →
        </Link>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            className="row-card"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <span className="row-card__title">{item.title}</span>
            {item.meta && <span className="row-card__meta">{item.meta}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}