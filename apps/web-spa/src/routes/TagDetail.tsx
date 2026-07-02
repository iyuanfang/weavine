import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, Contact } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const IMPORTANCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const IMPORTANCE_BADGE_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

const FALLBACK_TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: Tag): string {
  return tag.color ?? FALLBACK_TAG_COLORS[tag.name.length % FALLBACK_TAG_COLORS.length];
}

// ── Page ────────────────────────────────────────────

export function TagDetail() {
  const { tagId } = useParams() as { tagId: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  // ── Fetch tags (to get current tag's name + color) ─

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const currentTag = (tagsQuery.data ?? []).find((t) => t.id === tagId) ?? null;

  // ── Fetch contacts for this tag ───────────────────

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId, { tag_id: tagId }],
    queryFn: () =>
      adapter.contacts.list({
        owner_id: ownerId!,
        tag_id: tagId,
      }),
    enabled: !!ownerId,
  });

  // ── Guards ────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (tagsQuery.isError || contactsQuery.isError) {
    const err = tagsQuery.error ?? contactsQuery.error;
    return (
      <div className="today-page">
        <div className="error">加载失败: {String(err)}</div>
      </div>
    );
  }

  if (!currentTag) {
    return (
      <div className="today-page">
        <div className="empty-state">
          <p>标签不存在</p>
          <Link
            to="/tags"
            style={{
              display: 'inline-block',
              marginTop: 12,
              fontSize: 13,
              color: 'var(--accent)',
              fontWeight: 500,
            }}
          >
            ← 返回标签列表
          </Link>
        </div>
      </div>
    );
  }

  const contacts = contactsQuery.data ?? [];
  const isLoading = contactsQuery.isLoading || tagsQuery.isLoading;

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: tagColor(currentTag),
            }}
          />
          <h1 className="section__title">{currentTag.name}</h1>
        </div>
        <Link
          to="/tags"
          style={{
            fontSize: 13,
            color: 'var(--accent)',
            textDecoration: 'none',
          }}
        >
          ← 返回标签列表
        </Link>
      </div>

      {/* Result count */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        共 {contacts.length} 个联系人
      </div>

      {/* Contacts list */}
      {isLoading ? (
        <div className="loading">…</div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          <p>该标签下还没有联系人</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Contact Row ─────────────────────────────────────

function ContactRow({ contact }: { contact: Contact }) {
  const impLabel = IMPORTANCE_LABELS[contact.importance] ?? '';
  const impColor = IMPORTANCE_BADGE_COLORS[contact.importance] ?? '#6b7280';

  return (
    <Link
      to={`/contacts/${contact.id}`}
      className="row-card"
      style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="row-card__title">{contact.nickname}</span>
          {contact.company && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {contact.company}
            </span>
          )}
        </div>
        {contact.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {contact.tags.map((tag) => (
              <span
                key={tag.id}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tagColor(tag),
                  flexShrink: 0,
                }}
                title={tag.name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Importance badge */}
      {impLabel && (
        <span
          style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${impColor}18`,
            color: impColor,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {impLabel}
        </span>
      )}

      <span
        style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}
      >
        查看
      </span>
    </Link>
  );
}