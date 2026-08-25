import { Link } from 'react-router-dom';

interface Props {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  from?: string;
  variant?: 'card' | 'row';
  className?: string;
}

function stripMarkdown(body: string): string {
  return body
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*?(.+?)\*\*?/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(body: string, max = 100): string {
  const stripped = stripMarkdown(body);
  return stripped.length > max ? `${stripped.slice(0, max)}…` : stripped;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function NoteListItem({
  id,
  title,
  body,
  updatedAt,
  from,
  variant = 'card',
  className,
}: Props) {
  const href = from ? `/notes/${id}?from=${encodeURIComponent(from)}` : `/notes/${id}`;
  const displayTitle = title || '（无标题）';
  const displaySnippet = snippet(body);
  const time = relTime(updatedAt);
  return (
    <Link to={href} className={`note-list-item note-list-item--${variant} ${className ?? ''}`.trim()}>
      <div className="note-list-item__line1">
        <span className="note-list-item__title">{displayTitle}</span>
        {time && <span className="note-list-item__time">{time}</span>}
      </div>
      {displaySnippet && (
        <div className="note-list-item__snippet">{displaySnippet}</div>
      )}
    </Link>
  );
}

export function makeNoteSnippet(body: string, max = 100): string {
  return snippet(body, max);
}