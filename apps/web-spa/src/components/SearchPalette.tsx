import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';

interface Props {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface PaletteItem {
  key: string;
  href: string;
  title: string;
  meta: string;
  isArchived?: boolean;
  tag?: string;
}

function PaletteSection({
  title,
  items,
  activeKey,
  onSelect,
}: {
  title: string;
  items: PaletteItem[];
  activeKey: string | null;
  onSelect: (href: string) => void;
}) {
  return (
    <section className="section" style={{ marginBottom: 0 }}>
      <div className="section__header">
        <h2 className="section__title">{title}</h2>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map((item) => (
          <div
            key={item.key}
            role="link"
            tabIndex={0}
            className={`row-card${item.key === activeKey ? ' row-card--active' : ''}`}
            style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
            onClick={() => onSelect(item.href)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item.href);
              }
            }}
          >
            <span className="row-card__title" style={{ opacity: item.isArchived ? 0.65 : 1 }}>
              {item.isArchived && <span aria-hidden style={{ marginRight: 6 }}>📦</span>}
              {item.title}
            </span>
            {item.tag && (
              <span className="badge badge--muted" style={{ fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                {item.tag}
              </span>
            )}
            {item.meta && <span className="row-card__meta">{item.meta}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SearchPalette({ open, initialQuery = '', onClose }: Props) {
  const adapter = useAdapter();
  const userId = useUserId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 250);

  // Sync external open/initialQuery → local input.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialQuery]);

  const searchQuery = useQuery({
    queryKey: ['search-palette', userId, debouncedQuery],
    queryFn: () =>
      adapter.search.query(userId!, debouncedQuery, null, { include_archived: true }),
    enabled: !!userId && debouncedQuery.trim().length > 0,
  });

  const results = searchQuery.data;
  const contacts = results?.contacts ?? [];
  const interactions = results?.interactions ?? [];
  const events = results?.events ?? [];
  const actions = results?.actions ?? [];
  const projects = results?.projects ?? [];

  const sections = useMemo(
    () => [
      {
        title: '联系人',
        viewAllHref: '/contacts',
        items: contacts.map((c) => ({
          key: c.id,
          href: `/contacts/${c.id}?from=/search`,
          title: c.nickname,
          meta: c.company ?? '',
        })),
      },
      {
        title: '互动',
        viewAllHref: '/contacts',
        items: interactions.map((i) => ({
          key: i.id,
          href: `/interactions/${i.id}`,
          title: i.summary,
          meta: new Date(i.occurred_at).toLocaleDateString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
          }),
        })),
      },
      {
        title: '日程',
        viewAllHref: '/calendar',
        items: events.map((e) => ({
          key: e.id,
          href: `/events/${e.id}?from=/search`,
          title: e.title,
          meta: new Date(e.start_at).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          isArchived: !!e.archived_at,
        })),
      },
      {
        title: '待办',
        viewAllHref: '/actions',
        items: actions.map((a) => ({
          key: a.id,
          href: `/actions/${a.id}?from=/search`,
          title: a.title,
          meta: a.due_at
            ? new Date(a.due_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
            : '',
          isArchived: !!a.archived_at,
        })),
      },
      {
        title: '项目',
        viewAllHref: '/projects',
        items: projects.map((p) => ({
          key: p.id,
          href: `/projects/${p.id}?from=/search`,
          title: p.title,
          meta: p.stage,
          isArchived: !!p.archived_at,
        })),
      },
    ],
    [contacts, interactions, events, actions, projects],
  );

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Reset active selection whenever the result set changes.
  useEffect(() => {
    setActiveKey(flatItems.length > 0 ? flatItems[0].key : null);
  }, [debouncedQuery, flatItems]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    window.location.assign(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (flatItems.length === 0) return;
    const idx = flatItems.findIndex((i) => i.key === activeKey);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < 0 ? 0 : Math.min(idx + 1, flatItems.length - 1);
      setActiveKey(flatItems[next].key);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx <= 0 ? 0 : idx - 1;
      setActiveKey(flatItems[prev].key);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatItems[idx >= 0 ? idx : 0];
      if (target) go(target.href);
    }
  };

  const totalCount = flatItems.length;

  return (
    <div className="search-palette" role="dialog" aria-modal="true" aria-label="搜索">
      <div className="search-palette__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="search-palette__panel" onKeyDown={onKeyDown}>
        <div className="search-palette__input-row">
          <span className="search-palette__icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            className="search-palette__input"
            placeholder="搜索联系人、互动、日程、待办、项目…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索关键词"
          />
          {query && (
            <button
              type="button"
              className="search-palette__clear"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="清空"
            >
              ✕
            </button>
          )}
        </div>

        <div className="search-palette__results">
          {!debouncedQuery.trim() ? (
            <div className="empty-state">
              <h3 className="empty-state__title">想找什么？</h3>
              <p className="empty-state__hint">输入关键词开始搜索，或按 Esc 关闭</p>
            </div>
          ) : searchQuery.isLoading ? (
            <div className="loading">搜索中…</div>
          ) : searchQuery.isError ? (
            <div className="error-banner">搜索失败: {String(searchQuery.error)}</div>
          ) : totalCount > 0 ? (
            <div style={{ display: 'grid', gap: 24 }}>
              {sections.map(
                (s) =>
                  s.items.length > 0 && (
                    <PaletteSection
                      key={s.title}
                      title={s.title}
                      items={s.items}
                      activeKey={activeKey}
                      onSelect={go}
                    />
                  ),
              )}
            </div>
          ) : (
            <div className="empty-state">
              <h3 className="empty-state__title">未找到匹配的结果</h3>
              <p className="empty-state__hint">试试换个关键词</p>
            </div>
          )}
        </div>

        <div className="search-palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>↵</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
          <span className="search-palette__footer-hint">⌘K 是快速记录，与此无关</span>
        </div>
      </div>
    </div>
  );
}
