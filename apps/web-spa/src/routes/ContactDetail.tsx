import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Tag, CreateInteractionInput } from '../lib/adapter/types';

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

export function ContactDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Fetch data ────────────────────────────────────

  const contactQuery = useQuery({
    queryKey: ['contact', id],
    queryFn: () => adapter.contacts.get(id),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'for-contact', id],
    queryFn: () =>
      adapter.events.list({
        owner_id: ownerId!,
        contact_id: id,
        limit: 20,
      }),
    enabled: !!ownerId,
  });

  const actionsQuery = useQuery({
    queryKey: ['actions', ownerId, 'for-contact', id],
    queryFn: () =>
      adapter.actions.list({
        owner_id: ownerId!,
        contact_id: id,
        limit: 20,
      }),
    enabled: !!ownerId,
  });

  const interactionsQuery = useQuery({
    queryKey: ['interactions', ownerId, 'for-contact', id],
    queryFn: () =>
      adapter.interactions.list({
        owner_id: ownerId!,
        contact_id: id,
        limit: 20,
      }),
    enabled: !!ownerId,
  });

  // ── Inline interaction form ───────────────────────

  const [interactionSummary, setInteractionSummary] = useState('');
  const [interactionChannel, setInteractionChannel] = useState('');

  const createInteractionMutation = useMutation({
    mutationFn: (input: CreateInteractionInput) => adapter.interactions.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['interactions', ownerId, 'for-contact', id],
      });
      setInteractionSummary('');
      setInteractionChannel('');
    },
  });

  const handleCreateInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactionSummary.trim() || !ownerId) return;

    createInteractionMutation.mutate({
      owner_id: ownerId,
      contact_id: id,
      occurred_at: new Date().toISOString(),
      channel: interactionChannel.trim() || null,
      summary: interactionSummary.trim(),
    });
  };

  // ── Delete contact ────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => adapter.contacts.delete(contactId),
    onSuccess: () => {
      navigate('/contacts');
    },
  });

  const handleDelete = () => {
    if (confirm('确定要删除这个联系人吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  // ── Guards ────────────────────────────────────────

  if (contactQuery.isLoading) {
    return <div className="loading">…</div>;
  }

  if (contactQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载联系人失败: {String(contactQuery.error)}</div>
      </div>
    );
  }

  const contact = contactQuery.data!;
  const events = eventsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const interactions = interactionsQuery.data ?? [];

  // ── Derived ───────────────────────────────────────

  const displayName = contact.nickname || contact.name || '?';
  const impLabel = IMPORTANCE_LABELS[contact.importance] ?? '';
  const impColor = IMPORTANCE_BADGE_COLORS[contact.importance] ?? '#6b7280';

  const infoFields: [string, string | null][] = [
    ['昵称', contact.nickname],
    ['姓名', contact.name],
    ['公司', contact.company],
    ['职位', contact.title],
    ['城市', contact.city],
    ['邮箱', contact.email],
    ['电话', contact.phone],
    ['微信', contact.wechat],
  ].filter(([, v]) => v) as [string, string][];

  const isLoading =
    eventsQuery.isLoading ||
    actionsQuery.isLoading ||
    interactionsQuery.isLoading;

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 className="section__title">{displayName}</h1>
            {impLabel && (
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: `${impColor}18`,
                  color: impColor,
                  fontWeight: 500,
                }}
              >
                {impLabel}
              </span>
            )}
          </div>
          {/* Tags */}
          {contact.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {contact.tags.map((tag) => (
                <span
                  key={tag.id}
                  style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: `${tagColor(tag)}18`,
                    color: tagColor(tag),
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link
            to={`/contacts/${id}/edit`}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: '#fff',
              fontSize: 13,
              textDecoration: 'none',
              color: 'var(--fg)',
            }}
          >
            编辑
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: 8,
              background: '#ef4444',
              color: '#fff',
              fontSize: 13,
              cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: deleteMutation.isPending ? 0.6 : 1,
            }}
          >
            {deleteMutation.isPending ? '删除中…' : '删除'}
          </button>
        </div>
      </div>

      {/* Info section */}
      {infoFields.length > 0 && (
        <section className="section">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 16px' }}>
            {infoFields.map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: 14 }}>{v}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notes */}
      {contact.notes && (
        <section className="section">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>备注</div>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
            {contact.notes}
          </p>
        </section>
      )}

      {/* 相关日程 */}
      <section className="section">
        <div className="section__header">
          <h2 className="section__title">相关日程</h2>
          <Link to="/calendar" className="section__view-all">
            全部 →
          </Link>
        </div>
        {isLoading ? (
          <div className="loading">…</div>
        ) : events.length === 0 ? (
          <div className="empty-state">没有相关日程</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {events.map((e) => (
              <Link
                key={e.id}
                to={`/events/${e.id}`}
                className="row-card"
                style={{ textDecoration: 'none' }}
              >
                <span className="row-card__title">{e.title}</span>
                <span className="row-card__meta">
                  {new Date(e.start_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 待办 */}
      <section className="section">
        <div className="section__header">
          <h2 className="section__title">待办</h2>
          <Link to="/actions" className="section__view-all">
            全部 →
          </Link>
        </div>
        {isLoading ? (
          <div className="loading">…</div>
        ) : actions.length === 0 ? (
          <div className="empty-state">没有相关待办</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {actions.map((a) => (
              <Link
                key={a.id}
                to={`/actions/${a.id}`}
                className="row-card"
                style={{ textDecoration: 'none' }}
              >
                <span className="row-card__title">{a.title}</span>
                <span className="row-card__meta">{a.status}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 互动 + 记一笔 */}
      <section className="section">
        <div className="section__header">
          <h2 className="section__title">互动</h2>
        </div>

        {/* Inline interaction form */}
        <form
          onSubmit={handleCreateInteraction}
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            placeholder="互动渠道（可选，如：微信、邮件）"
            value={interactionChannel}
            onChange={(e) => setInteractionChannel(e.target.value)}
            style={{
              flex: '0 0 auto',
              minWidth: 120,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
              background: '#fff',
              outline: 'none',
            }}
          />
          <textarea
            placeholder="+ 记一笔…"
            value={interactionSummary}
            onChange={(e) => setInteractionSummary(e.target.value)}
            required
            style={{
              flex: 1,
              minWidth: 180,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
              background: '#fff',
              outline: 'none',
              resize: 'none',
              minHeight: 36,
            }}
          />
          <button
            type="submit"
            disabled={createInteractionMutation.isPending}
            style={{
              flex: '0 0 auto',
              padding: '6px 16px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: createInteractionMutation.isPending ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-end',
            }}
          >
            {createInteractionMutation.isPending ? '保存中…' : '记录'}
          </button>
        </form>

        {interactionsQuery.isLoading ? (
          <div className="loading">…</div>
        ) : interactions.length === 0 ? (
          <div className="empty-state">还没有互动记录</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {interactions.map((i) => (
              <div key={i.id} className="row-card">
                <span className="row-card__meta">
                  {new Date(i.occurred_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
                <span className="row-card__title">{i.summary}</span>
                {i.channel && (
                  <span className="row-card__meta">{i.channel}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}