import { useMemo, useState } from 'react';
import { useInfiniteList, useScrollSentinel } from '../lib/useInfiniteList';
import { useNavigate } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
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

export function NotesList() {
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const { items: notes, hasMore, isLoading, error: listError, fetchMore } = useInfiniteList({
    fetcher: (cursor) => adapter.notes.list(userId, cursor),
    resetTrigger: userId,
  });

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
          className="btn btn-secondary"
          onClick={async () => {
            const path = await adapter.md.openDialog();
            if (path) navigate(`/md-editor?path=${encodeURIComponent(path)}`);
          }}
        >
          📂 打开本地 .md
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('/notes/new')}
        >
          + 新建笔记
        </button>
      </header>

      {isLoading && notes.length === 0 && <div style={{textAlign:'center',padding:'8px 0',color:'var(--muted)',fontSize:'var(--text-sm)'}}>加载中…</div>}
      {hasMore && notes && notes.length > 0 && (
        <button type="button" className="btn btn-ghost" onClick={fetchMore} disabled={isLoading}
          style={{display:'block',margin:'8px auto'}}>{isLoading ? '加载中…' : '加载更多'}</button>
      )}
      {hasMore && notes && notes.length > 0 && <Sentinel fetchMore={fetchMore} isLoading={isLoading} hasMore={hasMore} />}
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

      {listError ? (
        <p className="muted" style={{ color: 'var(--error)' }}>
          {listError instanceof Error ? listError.message : '加载失败'}
        </p>
      ) : null}
      {notes && notes.length === 0 && !isLoading && (
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
      {filteredNotes && filteredNotes.length === 0 && notes && notes.length > 0 && (
        <p className="muted">没有匹配「{filter}」的笔记。</p>
      )}
      {filteredNotes && filteredNotes.length > 0 && (
        <NotesGroups notes={filteredNotes} />
      )}
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

function NotesGroups({ notes }: { notes: Note[] }) {
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