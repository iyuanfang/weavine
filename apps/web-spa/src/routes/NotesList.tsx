import { useMemo, useState } from 'react';
import { useInfiniteList, useScrollSentinel } from '../lib/useInfiniteList';
import { useNavigate } from 'react-router-dom';

import { useAdapter, isTauri } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import { mdEditorUrl } from '../lib/md-path';
import type { Note } from '../lib/adapter/types';
import { NoteListItem } from '../components/NoteListItem';

function dateBucket(iso: string): string {
  const t = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOf(now) - startOf(t)) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return '本周';
  if (days < 30) return '过去 30 天';
  return '更早';
}

type SortKey = 'updated' | 'created' | 'title';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近创建' },
  { value: 'title', label: '标题 A-Z' },
];

const LINK_KINDS: { value: string; label: string; color: string }[] = [
  { value: 'contact', label: '联系人', color: '#2563eb' },
  { value: 'project', label: '项目', color: '#7c3aed' },
  { value: 'event', label: '日程', color: '#10b981' },
  { value: 'action', label: '待办', color: '#f59e0b' },
  { value: 'interaction', label: '互动', color: '#0ea5e9' },
];

type LinkedFilter = 'all' | 'none' | string;

export function NotesList() {
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [linked, setLinked] = useState<LinkedFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('updated');
  const { items: notes, hasMore, isLoading, error: listError, fetchMore } = useInfiniteList({
    fetcher: (cursor) => adapter.notes.list(userId, cursor),
    resetTrigger: userId,
  });

  const countsByKind = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const k of LINK_KINDS) acc[k.value] = 0;
    let unlinked = 0;
    for (const n of notes) {
      const types = n.entity_types ?? [];
      if (types.length === 0) unlinked += 1;
      for (const t of types) if (acc[t] !== undefined) acc[t] += 1;
    }
    return { byKind: acc, unlinked };
  }, [notes]);

  const filteredNotes = useMemo(() => {
    if (!notes) return null;
    const q = search.trim().toLowerCase();
    const matched = notes.filter((n) => {
      if (q && !n.title.toLowerCase().includes(q) && !n.body.toLowerCase().includes(q)) {
        return false;
      }
      if (linked === 'all') return true;
      const types = n.entity_types ?? [];
      if (linked === 'none') return types.length === 0;
      return types.includes(linked);
    });
    const sorted = [...matched];
    if (sortBy === 'created') {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
    }
    // 'updated' keeps the server's updated_at DESC order.
    return sorted;
  }, [notes, search, linked, sortBy]);

  const hasActiveFilter = Boolean(search.trim() || linked !== 'all');
  const clearAll = () => {
    setSearch('');
    setLinked('all');
  };

  return (
    <div className="page page--wide notes-list">
      <header className="page-header">
        <div>
          <h1 className="page-title">笔记</h1>
          <p className="page-subtitle">
            {(notes ?? []).length} 篇
            {hasActiveFilter && filteredNotes && (
              <> · 筛选出 {filteredNotes.length} 篇</>
            )}
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
              ' · 按关联和关键词查找你的记录'
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isTauri && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                const path = await adapter.md.openDialog();
                if (path) navigate(mdEditorUrl(path));
              }}
            >
              📂 打开文件
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/notes/new')}
          >
            + 新建笔记
          </button>
        </div>
      </header>

      <div className="layout-split">
        <aside className="filter-panel">
          <div className="filter-panel__section">
            <div className="filter-panel__title">搜索</div>
            <input
              type="text"
              className="input-base"
              placeholder="标题、正文…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                onClick={() => setSortBy(opt.value)}
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
            <div className="filter-panel__title">关联</div>
            <button
              type="button"
              onClick={() => setLinked('all')}
              className={`filter-panel__item ${
                linked === 'all' ? 'filter-panel__item--active' : ''
              }`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 'var(--text-base)' }}>●</span>
                <span>全部</span>
              </span>
              <span className="filter-panel__count">{(notes ?? []).length}</span>
            </button>
            <button
              type="button"
              onClick={() => setLinked('none')}
              className={`filter-panel__item ${
                linked === 'none' ? 'filter-panel__item--active' : ''
              }`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="filter-panel__item-dot"
                  style={{ background: '#cbd5e1' }}
                />
                <span>未关联</span>
              </span>
              <span className="filter-panel__count">{countsByKind.unlinked}</span>
            </button>
            {LINK_KINDS.filter(
              (k) => (countsByKind.byKind[k.value] ?? 0) > 0 || linked === k.value,
            ).map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setLinked(k.value)}
                className={`filter-panel__item ${
                  linked === k.value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="filter-panel__item-dot"
                    style={{ background: k.color }}
                  />
                  <span>{k.label}</span>
                </span>
                <span className="filter-panel__count">
                  {countsByKind.byKind[k.value] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div>
          {isLoading && notes.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '8px 0',
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
              }}
            >
              加载中…
            </div>
          )}
          {hasMore && notes.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={fetchMore}
              disabled={isLoading}
              style={{ display: 'block', margin: '8px auto' }}
            >
              {isLoading ? '加载中…' : '加载更多'}
            </button>
          )}
          {hasMore && notes.length > 0 && (
            <Sentinel fetchMore={fetchMore} isLoading={isLoading} hasMore={hasMore} />
          )}

          {listError ? (
            <p className="muted" style={{ color: 'var(--error)' }}>
              {listError instanceof Error ? listError.message : '加载失败'}
            </p>
          ) : null}
          {notes.length === 0 && !isLoading && (
            <div className="empty-state">
              <h3 className="empty-state__title">还没有笔记</h3>
              <p className="empty-state__hint">
                点上面「+ 新建笔记」开始，或在联系人/项目里点「+ 笔记」直接关联。
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 12 }}
                onClick={() => navigate('/notes/new')}
              >
                + 新建笔记
              </button>
            </div>
          )}
          {filteredNotes && filteredNotes.length === 0 && notes.length > 0 && (
            <div className="empty-state">没有匹配的笔记。</div>
          )}
          {filteredNotes && filteredNotes.length > 0 && (
            <NotesGroups notes={filteredNotes} grouped={sortBy === 'updated'} />
          )}
        </div>
      </div>
    </div>
  );
}

function Sentinel({
  fetchMore,
  isLoading,
  hasMore,
}: {
  fetchMore: () => Promise<void>;
  isLoading: boolean;
  hasMore: boolean;
}) {
  const ref = useScrollSentinel(fetchMore, { enabled: true, isLoading, hasMore });
  return <div ref={ref} style={{ height: 1 }} />;
}

const BUCKET_ORDER = ['今天', '昨天', '本周', '过去 30 天', '更早'];

function NotesGroups({ notes, grouped }: { notes: Note[]; grouped: boolean }) {
  const groups = useMemo(() => {
    if (!grouped) return [{ label: '', items: notes }];
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const b = dateBucket(n.updated_at);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(n);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ label: b, items: map.get(b)! }));
  }, [notes, grouped]);
  return (
    <div className="notes-list__groups">
      {groups.map((g) => (
        <section key={g.label || 'all'} className="notes-list__group">
          {g.label && <h2 className="notes-list__group-title">{g.label}</h2>}
          <ul className="notes-list__items">
            {g.items.map((n) => (
              <li key={n.id} className="notes-list__item">
                <NoteListItem
                  id={n.id}
                  title={n.title}
                  body={n.body}
                  updatedAt={n.updated_at}
                  from="/notes"
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
