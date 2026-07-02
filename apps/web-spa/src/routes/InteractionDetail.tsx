import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';

// ── Helpers ──────────────────────────────────────────

function formatDateTime(d: Date): string {
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ── Page ────────────────────────────────────────────

export function InteractionDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const navigate = useNavigate();

  // ── Fetch interaction ─────────────────────────────

  const interactionQuery = useQuery({
    queryKey: ['interaction', id],
    queryFn: () => adapter.interactions.get(id),
  });

  // ── Fetch contact (if set) ────────────────────────

  const contactQuery = useQuery({
    queryKey: ['contact', interactionQuery.data?.contact_id],
    queryFn: () =>
      adapter.contacts.get(interactionQuery.data!.contact_id!),
    enabled: !!interactionQuery.data?.contact_id,
  });

  // ── Fetch event (if set) ──────────────────────────

  const eventQuery = useQuery({
    queryKey: ['event', interactionQuery.data?.event_id],
    queryFn: () => adapter.events.get(interactionQuery.data!.event_id!),
    enabled: !!interactionQuery.data?.event_id,
  });

  // ── Fetch action (if set) ─────────────────────────

  const actionQuery = useQuery({
    queryKey: ['action', interactionQuery.data?.action_id],
    queryFn: () => adapter.actions.get(interactionQuery.data!.action_id!),
    enabled: !!interactionQuery.data?.action_id,
  });

  // ── Delete mutation ───────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (interactionId: string) => adapter.interactions.delete(interactionId),
    onSuccess: () => {
      navigate('/contacts');
    },
  });

  const handleDelete = () => {
    if (confirm('确定要删除这条互动记录吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  // ── Guards ────────────────────────────────────────

  if (interactionQuery.isLoading) {
    return <div className="loading">…</div>;
  }

  if (interactionQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载互动失败: {String(interactionQuery.error)}</div>
      </div>
    );
  }

  const interaction = interactionQuery.data!;
  const contact = contactQuery.data ?? null;
  const event = eventQuery.data ?? null;
  const action = actionQuery.data ?? null;

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <h1 className="section__title">互动详情</h1>
        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: 'none',
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

      {/* Interaction details */}
      <section className="section">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 16px' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>时间</div>
            <div style={{ fontSize: 14 }}>
              {formatDateTime(new Date(interaction.occurred_at))}
            </div>
          </div>
          {interaction.channel && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>渠道</div>
              <div style={{ fontSize: 14 }}>{interaction.channel}</div>
            </div>
          )}
        </div>
      </section>

      {/* Summary */}
      <section className="section">
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>摘要</div>
        <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
          {interaction.summary}
        </p>
      </section>

      {/* Associated links */}
      <section className="section">
        <h2 className="section__title">关联记录</h2>
        <ul style={{ margin: '12px 0 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {contact && (
            <li>
              <Link
                to={`/contacts/${contact.id}`}
                style={{
                  fontSize: 14,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                👤 {contact.nickname ?? contact.name ?? '?'}
              </Link>
            </li>
          )}
          {event && (
            <li>
              <Link
                to={`/events/${event.id}`}
                style={{
                  fontSize: 14,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                📅 {event.title}
              </Link>
            </li>
          )}
          {action && (
            <li>
              <Link
                to={`/actions/${action.id}`}
                style={{
                  fontSize: 14,
                  color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                ☑ {action.title}
              </Link>
            </li>
          )}
          {!contact && !event && !action && (
            <li style={{ fontSize: 14, color: 'var(--muted)' }}>无关联记录</li>
          )}
        </ul>
      </section>
    </div>
  );
}