import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag } from '../lib/adapter/types';

// ── Helpers ──────────────────────────────────────────

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const IMPORTANCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const IMPORTANCE_VALUES = ['high', 'medium', 'low'] as const;

const FALLBACK_TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: Tag): string {
  return tag.color ?? FALLBACK_TAG_COLORS[tag.name.length % FALLBACK_TAG_COLORS.length];
}

const IMPORTANCE_BADGE_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

// ── Page component ───────────────────────────────────

export function ContactsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  // Filters
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedImportance, setSelectedImportance] = useState<string | null>(null);

  // Fetch tags (for filter chips)
  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  // Fetch contacts
  const contactsQuery = useQuery({
    queryKey: [
      'contacts',
      ownerId,
      { search: debouncedSearch, tag_id: selectedTagId, importance: selectedImportance },
    ],
    queryFn: () =>
      adapter.contacts.list({
        owner_id: ownerId!,
        tag_id: selectedTagId,
        search: debouncedSearch || null,
        importance: selectedImportance,
      }),
    enabled: !!ownerId,
  });

  // ── Guards ───────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (contactsQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载失败: {String(contactsQuery.error)}</div>
      </div>
    );
  }

  // ── Derived state ────────────────────────────────

  const contacts = contactsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const isLoading = contactsQuery.isLoading;

  const hasActiveFilter = Boolean(debouncedSearch || selectedTagId || selectedImportance);

  // ── Render ───────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <h1 className="section__title">联系人</h1>
        <Link
          to="/contacts/new"
          style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}
        >
          + 新建联系人
        </Link>
      </div>

      {/* Search input */}
      <input
        type="text"
        placeholder="搜索联系人…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 14,
          marginBottom: 12,
          background: '#fff',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {tags.map((tag) => {
            const active = selectedTagId === tag.id;
            const color = tagColor(tag);
            return (
              <button
                key={tag.id}
                onClick={() => setSelectedTagId(active ? null : tag.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: 'pointer',
                  border: `1px solid ${active ? color : 'var(--border)'}`,
                  background: active ? `${color}18` : '#fff',
                  color: active ? color : 'var(--fg)',
                  transition: 'all 0.1s',
                }}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Importance filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {IMPORTANCE_VALUES.map((value) => {
          const active = selectedImportance === value;
          const color = IMPORTANCE_BADGE_COLORS[value];
          return (
            <button
              key={value}
              onClick={() => setSelectedImportance(active ? null : value)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                cursor: 'pointer',
                border: `1px solid ${active ? color : 'var(--border)'}`,
                background: active ? `${color}18` : '#fff',
                color: active ? color : 'var(--fg)',
                transition: 'all 0.1s',
              }}
            >
              {IMPORTANCE_LABELS[value]}
            </button>
          );
        })}
      </div>

      {/* Result count */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        共 {contacts.length} 个联系人
      </div>

      {/* Content area */}
      {isLoading ? (
        <div className="loading">…</div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          {hasActiveFilter ? (
            <p>没有匹配的联系人</p>
          ) : (
            <>
              <p>还没有联系人。从一个你最近见过的人开始：</p>
              <ol
                style={{
                  textAlign: 'left',
                  margin: '12px auto',
                  maxWidth: 320,
                  lineHeight: 2,
                  fontSize: 13,
                }}
              >
                <li>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>1.</span>{' '}
                  点右上角「新建」，写下他的昵称
                </li>
                <li>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>2.</span>{' '}
                  给他打个标签（朋友/同事/投资人…）
                </li>
                <li>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>3.</span>{' '}
                  在联系人详情里加一条互动
                </li>
              </ol>
              <Link
                to="/contacts/new"
                style={{
                  display: 'inline-block',
                  marginTop: 12,
                  fontSize: 13,
                  color: 'var(--accent)',
                  fontWeight: 500,
                }}
              >
                + 添加第一个联系人
              </Link>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {contacts.map((c) => (
            <Link
              key={c.id}
              to={`/contacts/${c.id}`}
              className="row-card"
              style={{ textDecoration: 'none' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="row-card__title">{c.nickname}</span>
                  {c.company && (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {c.company}
                    </span>
                  )}
                </div>
                {c.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {c.tags.map((tag) => (
                      <span
                        key={tag.id}
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: tagColor(tag),
                          flexShrink: 0,
                        }}
                        title={tag.name}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Importance badge */}
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: `${IMPORTANCE_BADGE_COLORS[c.importance] || '#6b7280'}18`,
                  color: IMPORTANCE_BADGE_COLORS[c.importance] || '#6b7280',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {IMPORTANCE_LABELS[c.importance] ?? c.importance}
              </span>

              <span style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                查看
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
