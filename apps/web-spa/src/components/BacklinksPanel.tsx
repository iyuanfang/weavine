import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
import type { NoteBacklink } from '../lib/adapter/types';
import { NoteListItem } from './NoteListItem';

interface Props {
  entityType: 'contact' | 'project' | 'action' | 'event';
  entityId: string;
}

const COLLAPSED_LIMIT = 5;

export function BacklinksPanel({ entityType, entityId }: Props) {
  const adapter = useAdapter();
  const userId = useUserId();
  const [items, setItems] = useState<NoteBacklink[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    adapter.notes
      .listBacklinks(userId, entityType, entityId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, userId, entityType, entityId]);

  if (items === null) return null;
  const newHref = `/notes/new?link_${entityType}=${encodeURIComponent(entityId)}`;
  if (items.length === 0) {
    return (
      <section className="backlinks-panel">
        <div className="backlinks-panel__header">
          <h3 className="backlinks-panel__title">相关笔记</h3>
          <Link to={newHref} className="backlinks-panel__cta">
            + 新建笔记
          </Link>
        </div>
        <p className="backlinks-panel__empty">暂无笔记引用 — 点击上方按钮快速创建一条</p>
      </section>
    );
  }
  const overflow = items.length - COLLAPSED_LIMIT;
  const visible = expanded ? items : items.slice(0, COLLAPSED_LIMIT);
  return (
    <section className="backlinks-panel">
      <div className="backlinks-panel__header">
        <h3 className="backlinks-panel__title">相关笔记（{items.length}）</h3>
        <Link to={newHref} className="backlinks-panel__cta">
          + 新建笔记
        </Link>
      </div>
      <ul className="backlinks-panel__list">
        {visible.map((b) => (
          <li key={b.note_id} className="backlinks-panel__item">
            <NoteListItem
              id={b.note_id}
              title={b.note_title}
              body={b.snippet ?? ''}
              updatedAt={b.updated_at ?? ''}
              variant="row"
            />
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <button
          type="button"
          className="backlinks-panel__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : `展开全部（还有 ${overflow} 条）`}
        </button>
      )}
    </section>
  );
}