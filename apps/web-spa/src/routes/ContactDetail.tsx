import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import { tagColor } from '../lib/tagColor';
import type { CreateInteractionInput } from '../lib/adapter/types';

const IMPORTANCE_LABELS: Record<string, string> = {
  normal: '普通',
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

export function ContactDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => adapter.contacts.delete(contactId),
    onSuccess: () => {
      navigate('/contacts');
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

  const handleDelete = () => {
    if (confirm('确定要删除这个联系人吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  if (contactQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

  if (contactQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载联系人失败: {String(contactQuery.error)}</div>
      </div>
    );
  }

  const contact = contactQuery.data!;
  const events = eventsQuery.data ?? [];
  const actions = actionsQuery.data ?? [];
  const interactions = interactionsQuery.data ?? [];

  const displayName = contact.nickname || contact.name || '?';
  const imp = IMPORTANCE_BADGE[contact.importance] ?? IMPORTANCE_BADGE.low;
  const impLabel = IMPORTANCE_LABELS[contact.importance];

  const infoFields: [string, string | null][] = [
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

  return (
    <div className="page">
      <div
        className="card"
        style={{
          padding: 24,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            background: avatarBg(displayName),
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 28,
            flexShrink: 0,
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              {displayName}
            </h1>
            {impLabel && (
              <span className="badge" style={{ background: imp.bg, color: imp.fg }}>
                {impLabel}
              </span>
            )}
          </div>
          {contact.tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {contact.tags.map((tag) => (
                <Link
                  key={tag.id}
                  to={`/tags/${tag.id}`}
                  className="tag-chip"
                  style={{
                    background: `${tagColor(tag)}14`,
                    borderColor: `${tagColor(tag)}40`,
                    color: tagColor(tag),
                    textDecoration: 'none',
                  }}
                >
                  <span
                    className="tag-chip__dot"
                    style={{ background: tagColor(tag) }}
                  />
                  {tag.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Link to="/contacts" className="btn btn-ghost">
            ← 联系人列表
          </Link>
          <Link to={`/contacts/${id}/edit`} className="btn btn-secondary">
            编辑
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="btn btn-danger"
            style={{ opacity: deleteMutation.isPending ? 0.6 : 1 }}
          >
            {deleteMutation.isPending ? '删除中…' : '删除'}
          </button>
        </div>
      </div>

      {infoFields.length > 0 && (
        <section className="section">
          <h2 className="section__title">基本信息</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px 24px',
              }}
            >
              {infoFields.map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-muted" style={{ marginBottom: 2 }}>
                    {k}
                  </div>
                  <div style={{ fontSize: 14 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {contact.notes && (
        <section className="section">
          <h2 className="section__title">备注</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {contact.notes}
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">相关日程</h2>
          <Link to="/calendar" className="section__view-all">
            全部 →
          </Link>
        </div>
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : events.length === 0 ? (
          <div className="empty-state">没有相关日程</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {events.map((e) => (
              <Link
                key={e.id}
                to={`/events/${e.id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ fontSize: 18 }}>📅</span>
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

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">待办</h2>
          <Link to="/actions" className="section__view-all">
            全部 →
          </Link>
        </div>
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : actions.length === 0 ? (
          <div className="empty-state">没有相关待办</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {actions.map((a) => (
              <Link
                key={a.id}
                to={`/actions/${a.id}`}
                className="row-card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ fontSize: 18 }}>{a.status === 'done' ? '✅' : '📌'}</span>
                <span
                  className="row-card__title"
                  style={{
                    textDecoration: a.status === 'done' ? 'line-through' : 'none',
                    color: a.status === 'done' ? 'var(--muted)' : 'var(--fg)',
                  }}
                >
                  {a.title}
                </span>
                <span className="row-card__meta">{a.status}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">互动</h2>
        </div>

        <form onSubmit={handleCreateInteraction} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <input
              type="text"
              className="input-sm"
              placeholder="互动渠道（可选，如：微信、邮件）"
              value={interactionChannel}
              onChange={(e) => setInteractionChannel(e.target.value)}
            />
            <textarea
              className="input-base"
              placeholder="+ 记一笔这次互动…"
              value={interactionSummary}
              onChange={(e) => setInteractionSummary(e.target.value)}
              required
              style={{ minHeight: 60, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createInteractionMutation.isPending || !interactionSummary.trim()}
              >
                {createInteractionMutation.isPending ? '保存中…' : '记录'}
              </button>
            </div>
          </div>
        </form>

        {interactionsQuery.isLoading ? (
          <div className="loading">加载中</div>
        ) : interactions.length === 0 ? (
          <div className="empty-state">还没有互动记录</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {interactions.map((i) => (
              <div key={i.id} className="row-card">
                <span style={{ fontSize: 18 }}>💬</span>
                <span className="row-card__meta">
                  {new Date(i.occurred_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </span>
                <span className="row-card__title">{i.summary}</span>
                {i.channel && <span className="badge badge--muted">{i.channel}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}