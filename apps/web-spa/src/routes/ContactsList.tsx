import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ImportancePicker } from '../components/ImportancePicker';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { avatarBg } from '../lib/contactColor';
import { tagColor } from '../lib/tagColor';
import { parseCsv, parseVCard } from '../lib/import/parseContacts';
import type {
  CreateContactInput,
  Contact,
  ContactSortBy,
  UpdateContactInput,
} from '../lib/adapter/types';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// Run an array of async tasks with a fixed concurrency cap.
// Used by the CSV/vCard importer so a 1000-row sheet doesn't fire
// 1000 simultaneous Tauri invokes (the rusqlite connection lock
// would serialise them anyway, but each round-trip costs ~1ms).
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = new Array(items.length);
  let cursor = 0;

  const take = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      try {
        const value = await worker(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  };

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => take());
  await Promise.all(lanes);
  return results;
}

const IMPORTANCE_LABELS: Record<string, string> = {
  normal: '普通',
  high: '高',
  medium: '中',
  low: '低',
};

const IMPORTANCE_VALUES = ['normal', 'high', 'medium', 'low'] as const;

const IMPORTANCE_DOT: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#9ca3af',
};

const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: ContactSortBy; label: string }[] = [
  { value: 'last_contacted_at', label: '最近联系' },
  { value: 'created_at', label: '最近添加' },
  { value: 'nickname', label: '姓名 A-Z' },
];

export function ContactsList() {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedImportance, setSelectedImportance] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ContactSortBy>('last_contacted_at');
  const [page, setPage] = useState(0);

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateContactInput) => adapter.contacts.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
    },
  });

  const tagsQuery = useQuery({
    queryKey: ['tags', userId],
    queryFn: () => adapter.tags.list(userId!),
    enabled: !!userId,
  });

  const contactsQuery = useQuery({
    queryKey: [
      'contacts',
      userId,
      {
        search: debouncedSearch,
        tag_id: selectedTagId,
        importance: selectedImportance,
        sortBy,
        page,
      },
    ],
    queryFn: () =>
      adapter.contacts.list({
        user_id: userId!,
        tag_id: selectedTagId,
        search: debouncedSearch || null,
        importance: selectedImportance,
        sort_by: sortBy,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: !!userId,
  });

  if (!userId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (contactsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载失败: {String(contactsQuery.error)}</div>
      </div>
    );
  }

  const contacts = contactsQuery.data?.items ?? [];
  const total = contactsQuery.data?.total ?? 0;
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
    setPage(0);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? '');
      const lower = file.name.toLowerCase();
      const parsed =
        lower.endsWith('.vcf') || lower.endsWith('.vcard')
          ? parseVCard(text)
          : parseCsv(text);
      if (parsed.length === 0) {
        alert('未解析到任何联系人。请检查文件格式（CSV / vCard）或确认表头包含「昵称」列。');
        return;
      }
      if (!confirm(`将导入 ${parsed.length} 个联系人，是否继续？`)) return;
      if (!userId) return;

      const inputs: CreateContactInput[] = parsed.map((p) => ({
        user_id: userId,
        nickname: p.nickname,
        name: p.name ?? null,
        company: p.company ?? null,
        title: p.title ?? null,
        city: p.city ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        wechat: p.wechat ?? null,
        notes: p.notes ?? null,
      }));

      setImporting({ done: 0, total: inputs.length });
      let done = 0;
      const results = await runWithConcurrency(inputs, 5, async (input) => {
        const contact = await adapter.contacts.create(input);
        done += 1;
        setImporting({ done, total: inputs.length });
        return contact;
      });

      const failed = results.filter((r) => r.status === 'rejected').length;
      setImporting(null);
      queryClient.invalidateQueries({ queryKey: ['contacts', userId] });
      if (failed > 0) {
        alert(`导入完成：成功 ${results.length - failed} / 失败 ${failed}。请检查控制台日志。`);
      } else {
        alert(`导入完成：成功 ${results.length} 个联系人。`);
      }
    };
    reader.onerror = () => alert('读取文件失败');
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">联系人</h1>
          <p className="page-subtitle">
            {total} 个人 ·{' '}
            {hasActiveFilter ? (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  background: 'transparent',
                  border: 0,
                  fontSize: 'var(--text-sm)',
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => importFileRef.current?.click()}
            disabled={importing !== null}
            style={{ opacity: importing !== null ? 0.6 : 1 }}
          >
            {importing
              ? `导入中… ${importing.done}/${importing.total}`
              : '导入 CSV / vCard'}
          </button>
          <Link to="/contacts/new" className="btn btn-primary">
            + 新建联系人
          </Link>
        </div>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,.vcf,.vcard,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              autoComplete="off"
            />
          </div>

          <div className="filter-panel__divider" />

          <div className="filter-panel__section">
            <div className="filter-panel__title">排序</div>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setSortBy(opt.value);
                  setPage(0);
                }}
                className={`filter-panel__item ${
                  sortBy === opt.value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="filter-panel__divider" />

          <div className="filter-panel__section">
            <div className="filter-panel__title">重要性</div>
            <button
              type="button"
              onClick={() => {
                setSelectedImportance(null);
                setPage(0);
              }}
              className={`filter-panel__item ${
                selectedImportance === null ? 'filter-panel__item--active' : ''
              }`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 'var(--text-base)' }}>●</span>
                <span>全部</span>
              </span>
              <span className="filter-panel__count">{contacts.length}</span>
            </button>
            {IMPORTANCE_VALUES
              .filter((v) => (countsByImportance[v] ?? 0) > 0 || selectedImportance === v)
              .map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSelectedImportance(value);
                    setPage(0);
                  }}
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
                  onClick={() => {
                    setSelectedTagId(null);
                    setPage(0);
                  }}
                  className={`filter-panel__item ${
                    selectedTagId === null ? 'filter-panel__item--active' : ''
                  }`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 'var(--text-base)' }}>●</span>
                    <span>全部</span>
                  </span>
                  <span className="filter-panel__count">{contacts.length}</span>
                </button>
                {tags
                  .filter((tag) => (countsByTag[tag.id] ?? 0) > 0 || selectedTagId === tag.id)
                  .map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        setSelectedTagId(tag.id);
                        setPage(0);
                      }}
                      className={`filter-panel__item ${
                        selectedTagId === tag.id ? 'filter-panel__item--active' : ''
                      }`}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                        <span
                          className="filter-panel__item-dot"
                          style={{ background: tagColor(tag), flexShrink: 0 }}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                          }}
                          title={tag.name}
                        >
                          {tag.name}
                        </span>
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
            <div>
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
              {total > PAGE_SIZE && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    padding: '16px 0 4px',
                    marginTop: 12,
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    ← 上一页
                  </button>
                  <span
                    style={{
                      fontSize: 'var(--text-sm)',
                      color: 'var(--muted)',
                      minWidth: 160,
                      textAlign: 'center',
                    }}
                  >
                    第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页 · 共 {total} 人
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= Math.ceil(total / PAGE_SIZE) - 1}
                  >
                    下一页 →
                  </button>
                </div>
              )}
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
        to={`/contacts/${c.id}?from=/contacts`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
      >
        <div
          className="avatar avatar--sm"
          style={{ background: avatarBg(displayName) }}
        >
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="row-card__title">{displayName}</span>
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
            <div className="cluster cluster--tight" style={{ marginTop: 5 }}>
              {c.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag.id}
                  className="tag-chip"
                  style={{
                    background: `${tagColor(tag)}14`,
                    borderColor: `${tagColor(tag)}40`,
                    color: tagColor(tag),
                    padding: '1px 8px',
                    fontSize: 'var(--text-xs)',
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
        to={`/contacts/${c.id}?from=/contacts`}
        style={{ fontSize: 'var(--text-base)', color: 'var(--muted)', textDecoration: 'none' }}
      >
        →
      </Link>
    </div>
  );
}