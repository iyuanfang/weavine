import { useEffect, useState } from 'react';
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

export function NotesList() {
  const adapter = useAdapter();
  const userId = useUserId() ?? '';
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);

  useEffect(() => {
    if (!userId) return;
    adapter.notes.list(userId).then(setNotes).catch(() => setNotes([]));
  }, [adapter, userId]);

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

      {notes === null && <p className="muted">加载中…</p>}
      {notes && notes.length === 0 && (
        <p className="muted">还没有笔记。点击右上角新建一条，或在快速记录里选「笔记」。</p>
      )}
      {notes && notes.length > 0 && (
        <ul className="notes-list__items">
          {notes.map((n) => (
            <li key={n.id} className="notes-list__item">
              <Link to={`/notes/${n.id}`} className="notes-list__link">
                <div className="notes-list__title">{n.title || '（无标题）'}</div>
                <div className="notes-list__snippet">{snippet(n.body) || '（空白）'}</div>
                <div className="notes-list__meta">更新于 {relTime(n.updated_at)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}