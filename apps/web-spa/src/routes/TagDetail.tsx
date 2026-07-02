import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, Contact } from '../lib/adapter/types';

const FALLBACK_TAG_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

function tagColor(tag: Tag): string {
  return tag.color ?? FALLBACK_TAG_COLORS[tag.name.length % FALLBACK_TAG_COLORS.length];
}

const IMPORTANCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const IMPORTANCE_BADGE: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fef2f2', fg: '#dc2626' },
  medium: { bg: '#fffbeb', fg: '#d97706' },
  low: { bg: '#f3f4f6', fg: '#6b7280' },
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

export function TagDetail() {
  const { tagId } = useParams() as { tagId: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const tagsQuery = useQuery({
    queryKey: ['tags', ownerId],
    queryFn: () => adapter.tags.list(ownerId!),
    enabled: !!ownerId,
  });

  const currentTag = (tagsQuery.data ?? []).find((t) => t.id === tagId) ?? null;

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId, { tag_id: tagId }],
    queryFn: () =>
      adapter.contacts.list({
        owner_id: ownerId!,
        tag_id: tagId,
      }),
    enabled: !!ownerId,
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (tagsQuery.isError || contactsQuery.isError) {
    const err = tagsQuery.error ?? contactsQuery.error;
    return (
      <div className="page">
        <div className="error-banner">加载失败: {String(err)}</div>
      </div>
    );
  }

  if (!currentTag) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3 className="empty-state__title">标签不存在</h3>
          <Link to="/tags" className="btn btn-primary" style={{ marginTop: 8 }}>
            ← 返回标签列表
          </Link>
        </div>
      </div>
    );
  }

  const contacts = contactsQuery.data ?? [];
  const isLoading = contactsQuery.isLoading || tagsQuery.isLoading;
  const color = tagColor(currentTag);

  return (
    <div className="page">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: color,
              }}
            />
            {currentTag.name}
          </span>
        }
        subtitle={`${contacts.length} 个联系人`}
        back={
          <Link to="/tags" className="btn btn-ghost">
            ← 返回
          </Link>
        }
      />

      {isLoading ? (
        <div className="loading">加载中</div>
      ) : contacts.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">该标签下还没有联系人</h3>
          <p className="empty-state__hint">给联系人的标签里选上「{currentTag.name}」</p>
          <Link to="/contacts" className="btn btn-primary">
            去看看联系人
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContactRow({ contact: c }: { contact: Contact }) {
  const displayName = c.nickname || c.name || '?';
  const { bg, fg } = IMPORTANCE_BADGE[c.importance] ?? IMPORTANCE_BADGE.low;
  const impLabel = IMPORTANCE_LABELS[c.importance];

  return (
    <Link
      to={`/contacts/${c.id}`}
      className="row-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
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
        {displayName.slice(0, 1).toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="row-card__title">{displayName}</span>
          {c.company && <span className="row-card__meta">· {c.company}</span>}
        </div>
        {c.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            {c.tags.slice(0, 5).map((tag) => (
              <span
                key={tag.id}
                className="tag-chip__dot"
                style={{ background: tagColor(tag) }}
                title={tag.name}
              />
            ))}
          </div>
        )}
      </div>

      {impLabel && (
        <span className="badge" style={{ background: bg, color: fg }}>
          {impLabel}
        </span>
      )}

      <span style={{ fontSize: 13, color: 'var(--muted)' }}>→</span>
    </Link>
  );
}