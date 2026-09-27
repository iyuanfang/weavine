import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAdapter } from '../lib/adapter';
import { useLocalUser } from '../lib/auth';
import { useGlobalSearch } from '../App';

interface SheetItem {
  to: string;
  label: string;
  icon: string;
}

const allItems: SheetItem[] = [
  { to: '/contacts', label: '联系人', icon: '👥' },
  { to: '/actions', label: '待办', icon: '✅' },
  { to: '/calendar', label: '日程', icon: '📅' },
  { to: '/notes', label: '笔记', icon: '📝' },
  { to: '/projects', label: '项目', icon: '📁' },
  { to: '/tags', label: '标签', icon: '🏷️' },
  { to: '/archive', label: '归档', icon: '📦' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FeedEntry {
  key: string;
  icon: string;
  title: string;
  timeLabel: string;
  occurredAt: number;
  done: boolean;
  href: string;
}

function timeAgo(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Mobile drawer — opened from the top ☰ or the bottom-nav 更多 tab.
 * Sections: global search, a mixed "近期" timeline (todos + events +
 * interactions + notes, newest first), the full page directory (what the
 * old MoreSheet had), and the account footer.
 */
export function MoreSheet({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { open: openSearch } = useGlobalSearch();
  const { data: user } = useLocalUser();
  const adapter = useAdapter();
  const userId = user?.id ?? '';
  const [now] = useState(() => Date.now());

  const actionsQuery = useQuery({
    queryKey: ['drawer-actions', userId],
    queryFn: () => adapter.actions.list({ user_id: userId, limit: 8 }),
    enabled: open && !!userId,
  });
  const eventsQuery = useQuery({
    queryKey: ['drawer-events', userId],
    queryFn: () => adapter.events.list({ user_id: userId, limit: 8 }),
    enabled: open && !!userId,
  });
  const interactionsQuery = useQuery({
    queryKey: ['drawer-interactions', userId],
    queryFn: () => adapter.interactions.list({ user_id: userId, limit: 8 }),
    enabled: open && !!userId,
  });
  const notesQuery = useQuery({
    queryKey: ['drawer-notes', userId],
    queryFn: () => adapter.notes.list(userId, null),
    enabled: open && !!userId,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleItemClick = (item: SheetItem) => {
    onClose();
    navigate(item.to);
  };

  const feed: FeedEntry[] = [];
  for (const a of actionsQuery.data ?? []) {
    feed.push({
      key: `a:${a.id}`,
      icon: '✅',
      title: a.title,
      timeLabel: timeAgo(a.updated_at, now),
      occurredAt: new Date(a.updated_at).getTime() || 0,
      done: a.status === 'done',
      href: `/actions/${a.id}?from=/today`,
    });
  }
  for (const e of eventsQuery.data ?? []) {
    feed.push({
      key: `e:${e.id}`,
      icon: '📅',
      title: e.title,
      timeLabel: timeAgo(e.start_at, now),
      occurredAt: new Date(e.start_at).getTime() || 0,
      done: false,
      href: `/events/${e.id}?from=/today`,
    });
  }
  for (const i of interactionsQuery.data ?? []) {
    feed.push({
      key: `i:${i.id}`,
      icon: '💬',
      title: i.summary,
      timeLabel: timeAgo(i.occurred_at, now),
      occurredAt: new Date(i.occurred_at).getTime() || 0,
      done: false,
      href: `/interactions/${i.id}?from=/today`,
    });
  }
  for (const n of notesQuery.data?.items ?? []) {
    feed.push({
      key: `n:${n.id}`,
      icon: '📝',
      title: n.title,
      timeLabel: timeAgo(n.updated_at, now),
      occurredAt: new Date(n.updated_at).getTime() || 0,
      done: false,
      href: `/notes/${n.id}?from=/today`,
    });
  }
  feed.sort((a, b) => b.occurredAt - a.occurredAt);
  const recent = feed.slice(0, 10);

  return (
    <>
      <div className="more-sheet__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="菜单"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="more-sheet__handle" aria-hidden="true" />

        <button
          type="button"
          className="more-sheet__search"
          onClick={() => {
            onClose();
            openSearch();
          }}
          aria-label="搜索"
        >
          <span aria-hidden="true">🔍</span>
          <span>搜索人脉、待办、笔记…</span>
        </button>

        {recent.length > 0 && (
          <div className="more-sheet__section">
            <div className="more-sheet__section-title">近期</div>
            <ul className="more-sheet__list more-sheet__list--feed">
              {recent.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    className={`more-sheet__item more-sheet__feed-row${entry.done ? ' more-sheet__feed-row--done' : ''}`}
                    onClick={() => handleItemClick({ to: entry.href, label: entry.title, icon: entry.icon })}
                  >
                    <span className="more-sheet__item-icon" aria-hidden="true">
                      {entry.icon}
                    </span>
                    <span className="more-sheet__feed-title">{entry.title}</span>
                    <span className="more-sheet__feed-time">{entry.timeLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="more-sheet__section">
          <div className="more-sheet__section-title">全部</div>
          <ul className="more-sheet__list">
            {allItems.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className="more-sheet__item"
                  onClick={() => handleItemClick(item)}
                >
                  <span className="more-sheet__item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="more-sheet__item-label">{item.label}</span>
                  <span className="more-sheet__item-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="more-sheet__account">
          <span className="more-sheet__account-name">
            {user?.name ?? user?.email ?? '未登录'}
          </span>
        </div>

        <div className="more-sheet__safe-area" aria-hidden="true" />
      </div>
    </>
  );
}
