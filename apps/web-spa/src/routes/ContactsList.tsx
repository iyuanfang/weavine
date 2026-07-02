import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag } from '../lib/adapter/types';

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

const IMPORTANCE_BADGE: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fee2e2', fg: '#dc2626' },
  medium: { bg: '#fef3c7', fg: '#d97706' },
  low: { bg: '#f3f4f6', fg: '#6b7280' },
};

export function ContactsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedImportance, setSelectedImportance] = useState<string | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

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

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (contactsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载失败: {String(contactsQuery.error)}</div>
      </div>
    );
  }

  const contacts = contactsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const isLoading = contactsQuery.isLoading;
  const hasActiveFilter = Boolean(debouncedSearch || selectedTagId || selectedImportance);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">联系人</h1>
          <p className="page-subtitle">{contacts.length} 个人</p>
        </div>
        <Link to="/contacts/new" className="btn btn-primary">
          + 新建联系人
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <input
          type="text"
          className="input-base"
          placeholder="搜索姓名、昵称、公司…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {tags.map((tag) => {
              const active = selectedTagId === tag.id;
              const color = tagColor(tag);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => setSelectedTagId(active ? null : tag.id)}
                  className={`tag-chip ${active ? 'tag-chip--active' : ''}`}
                  style={active ? { borderColor: color, background: `${color}18`, color } : undefined}
                >
                  <span className="tag-chip__dot" style={{ background: color }} />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {IMPORTANCE_VALUES.map((value) => {
            const active = selectedImportance === value;
            const { bg, fg } = IMPORTANCE_BADGE[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedImportance(active ? null : value)}
                className={`tag-chip ${active ? 'tag-chip--active' : ''}`}
                style={
                  active
                    ? { borderColor: fg, background: bg, color: fg }
                    : undefined
                }
              >
                {IMPORTANCE_LABELS[value]}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="loading">加载联系人…</div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">
            {hasActiveFilter ? '没有匹配的联系人' : '还没有联系人'}
          </h3>
          <p className="empty-state__hint">
            {hasActiveFilter
              ? '试着清空筛选条件，或者新建一个联系人。'
              : '从一个你最近见过的人开始建立你的人脉网络。'}
          </p>
          <Link to="/contacts/new" className="btn btn-primary">
            {hasActiveFilter ? '+ 新建联系人' : '+ 添加第一个联系人'}
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {contacts.map((c) => {
            const { bg, fg } = IMPORTANCE_BADGE[c.importance] ?? IMPORTANCE_BADGE.low;
            return (
              <Link
                key={c.id}
                to={`/contacts/${c.id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                >
                  {(c.nickname || c.name || '?').slice(0, 1).toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="row-card__title">{c.nickname}</span>
                    {c.company && (
                      <span className="row-card__meta">· {c.company}</span>
                    )}
                  </div>
                  {c.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      {c.tags.slice(0, 5).map((tag) => (
                        <span
                          key={tag.id}
                          className="tag-chip__dot"
                          style={{ background: tagColor(tag) }}
                          title={tag.name}
                        />
                      ))}
                      {c.tags.length > 5 && (
                        <span className="text-xs text-muted">+{c.tags.length - 5}</span>
                      )}
                    </div>
                  )}
                </div>

                <span
                  className="badge"
                  style={{ background: bg, color: fg }}
                >
                  {IMPORTANCE_LABELS[c.importance] ?? c.importance}
                </span>

                <span style={{ fontSize: 13, color: 'var(--muted)' }}>查看 →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}