import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ImportancePicker } from '../components/ImportancePicker';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, Contact, UpdateContactInput } from '../lib/adapter/types';

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

const IMPORTANCE_DOT: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#9ca3af',
};

function avatarBg(name: string): string {
  const palettes = [
    'linear-gradient(135deg, #6366f1, #3b82f6)',
    'linear-gradient(135deg, #ec4899, #f43f5e)',
    'linear-gradient(135deg, #10b981, #14b8a6)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #8b5cf6, #6366f1)',
    'linear-gradient(135deg, #06b6d4, #3b82f6)',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return palettes[Math.abs(hash) % palettes.length];
}

export function ContactsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedImportance, setSelectedImportance] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateContactInput) => adapter.contacts.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts', ownerId] });
    },
  });

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

  const countsByImportance = IMPORTANCE_VALUES.reduce<Record<string, number>>(
    (acc, v) => {
      acc[v] = contacts.filter((c) => c.importance === v).length;
      return acc;
    },
    {},
  );

  const countsByTag = tags.reduce<Record<string, number>>((acc, tag) => {
    acc[tag.id] = contacts.filter((c) => c.tags.some((t) => t.id === tag.id)).length;
    return acc;
  }, {});

  const clearAll = () => {
    setSearch('');
    setSelectedTagId(null);
    setSelectedImportance(null);
  };

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">联系人</h1>
          <p className="page-subtitle">
            {contacts.length} 个人 ·{' '}
            {hasActiveFilter ? (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  background: 'transparent',
                  border: 0,
                  fontSize: 12,
                  padding: '0 4px',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                清除筛选
              </button>
            ) : (
              '按标签和重要性管理你的人脉网络'
            )}
          </p>
        </div>
        <Link to="/contacts/new" className="btn btn-primary">
          + 新建联系人
        </Link>
      </div>

      <div className="layout-split">
        <aside className="filter-panel">
          <div className="filter-panel__section">
            <div className="filter-panel__title">搜索</div>
            <input
              type="text"
              className="input-base"
              placeholder="姓名、公司…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="filter-panel__divider" />

          <div className="filter-panel__section">
            <div className="filter-panel__title">重要性</div>
            <button
              type="button"
              onClick={() => setSelectedImportance(null)}
              className={`filter-panel__item ${
                selectedImportance === null ? 'filter-panel__item--active' : ''
              }`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>●</span>
                <span>全部</span>
              </span>
              <span className="filter-panel__count">{contacts.length}</span>
            </button>
            {IMPORTANCE_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedImportance(value)}
                className={`filter-panel__item ${
                  selectedImportance === value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="filter-panel__item-dot"
                    style={{ background: IMPORTANCE_DOT[value] }}
                  />
                  <span>{IMPORTANCE_LABELS[value]}</span>
                </span>
                <span className="filter-panel__count">{countsByImportance[value] ?? 0}</span>
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <>
              <div className="filter-panel__divider" />
              <div className="filter-panel__section">
                <div className="filter-panel__title">标签</div>
                <button
                  type="button"
                  onClick={() => setSelectedTagId(null)}
                  className={`filter-panel__item ${
                    selectedTagId === null ? 'filter-panel__item--active' : ''
                  }`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>●</span>
                    <span>全部</span>
                  </span>
                  <span className="filter-panel__count">{contacts.length}</span>
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedTagId(tag.id)}
                    className={`filter-panel__item ${
                      selectedTagId === tag.id ? 'filter-panel__item--active' : ''
                    }`}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className="filter-panel__item-dot"
                        style={{ background: tagColor(tag) }}
                      />
                      <span>{tag.name}</span>
                    </span>
                    <span className="filter-panel__count">{countsByTag[tag.id] ?? 0}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="filter-panel__action">
            <Link
              to="/contacts/new"
              className="btn btn-secondary"
              style={{ width: '100%' }}
            >
              + 新建联系人
            </Link>
          </div>
        </aside>

        <div className="layout-split__main">
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
            <div style={{ display: 'grid', gap: 6 }}>
              {contacts.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  onChangeImportance={(newImp) =>
                    updateMutation.mutate({ id: c.id, importance: newImp })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  contact: c,
  onChangeImportance,
}: {
  contact: Contact;
  onChangeImportance: (value: string) => void;
}) {
  const displayName = c.nickname || c.name || '?';
  const initials = displayName.slice(0, 1).toUpperCase();

  return (
    <div
      className="row-card"
      style={{ padding: '14px 18px' }}
    >
      <Link
        to={`/contacts/${c.id}`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: avatarBg(displayName),
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 15,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="row-card__title" style={{ fontSize: 14 }}>
              {displayName}
            </span>
            {c.name && c.name !== c.nickname && (
              <span className="row-card__meta">{c.name}</span>
            )}
            {c.company && (
              <>
                <span className="row-card__meta">·</span>
                <span className="row-card__meta">{c.company}</span>
              </>
            )}
          </div>
          {c.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
              {c.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag.id}
                  className="tag-chip"
                  style={{
                    background: `${tagColor(tag)}14`,
                    borderColor: `${tagColor(tag)}40`,
                    color: tagColor(tag),
                    padding: '1px 8px',
                    fontSize: 11,
                  }}
                >
                  {tag.name}
                </span>
              ))}
              {c.tags.length > 4 && (
                <span className="text-xs text-muted">+{c.tags.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </Link>

      <ImportancePicker
        value={c.importance}
        onChange={onChangeImportance}
      />

      <Link
        to={`/contacts/${c.id}`}
        style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}
      >
        →
      </Link>
    </div>
  );
}