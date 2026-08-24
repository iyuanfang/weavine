import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { Note } from '../lib/adapter/types';

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function snippet(body: string, max = 140): string {
  const stripped = body.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

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

type ArchiveFilter = 'active' | 'archived' | 'all';

export function NotesList() {
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [filter, setFilter] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>('active');

  useEffect(() => {
    if (!userId) return;
    setNotes(null);
    adapter.notes.list(userId, { archived: archiveFilter }).then(setNotes).catch(() => setNotes([]));
  }, [adapter, userId, archiveFilter]);

  const filteredNotes = useMemo(() => {
    if (!notes) return null;
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, filter]);

  return (
    <div className="page notes-list">
      <header className="page-header">
        <h1>笔记</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('/notes/new')}
        >
          + 新建笔记
        </button>
      </header>

      <div className="notes-list__filter-row">
        <div className="notes-list__tabs" role="tablist" aria-label="笔记状态">
          {(['active', 'archived', 'all'] as ArchiveFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={archiveFilter === k}
              className={`notes-list__tab ${archiveFilter === k ? 'is-active' : ''}`}
              onClick={() => setArchiveFilter(k)}
            >
              {k === 'active' ? '活跃' : k === 'archived' ? '已归档' : '全部'}
            </button>
          ))}
        </div>
        {notes && notes.length > 0 && (
          <div className="notes-list__filter">
            <input
              type="search"
              className="input-base"
              placeholder="筛选笔记…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <span className="notes-list__filter-count">
                {filteredNotes!.length} / {notes.length}
              </span>
            )}
          </div>
        )}
      </div>

      {notes === null && <p className="muted">加载中…</p>}
      {notes && notes.length === 0 && (
        <div className="empty-state">
          <h3 className="empty-state__title">
            {archiveFilter === 'archived' ? '没有已归档的笔记' : '还没有笔记'}
          </h3>
          <p className="empty-state__hint">
            {archiveFilter === 'archived'
              ? '归档后的笔记会出现在这里。在笔记详情页点「归档」即可收纳。'
              : '点上面「+ 新建笔记」开始，或在联系人/项目里点「+ 笔记」直接关联。'}
          </p>
          {archiveFilter !== 'archived' && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => navigate('/notes/new')}
            >
              + 新建笔记
            </button>
          )}
        </div>
      )}
      {filteredNotes && filteredNotes.length === 0 && notes && notes.length > 0 && (
        <p className="muted">没有匹配「{filter}」的笔记。</p>
      )}
      {filteredNotes && filteredNotes.length > 0 && (
        <NotesGroups notes={filteredNotes} archiveFilter={archiveFilter} />
      )}
    </div>
  );
}

const BUCKET_ORDER = ['今天', '昨天', '本周', '过去 30 天', '更早'];

function NotesGroups({ notes, archiveFilter }: { notes: Note[]; archiveFilter: ArchiveFilter }) {
  const grouped = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const b = dateBucket(n.updated_at);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(n);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ label: b, items: map.get(b)! }));
  }, [notes]);
  return (
    <div className="notes-list__groups">
      {grouped.map((g) => (
        <section key={g.label} className="notes-list__group">
          <h2 className="notes-list__group-title">{g.label}</h2>
          <ul className="notes-list__items">
            {g.items.map((n) => (
              <li key={n.id} className={`notes-list__item ${archiveFilter !== 'active' && n.archived_at ? 'is-archived' : ''}`}>
                <Link to={`/notes/${n.id}`} className="notes-list__link">
                  <div className="notes-list__title">{n.title || '（无标题）'}</div>
                  <div className="notes-list__snippet">{snippet(n.body) || '（空白）'}</div>
                  <div className="notes-list__meta">
                    更新于 {relTime(n.updated_at)}
                    {n.archived_at && <span className="notes-list__badge">已归档</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}