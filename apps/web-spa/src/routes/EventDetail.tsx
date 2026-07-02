import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';

// ── Constants ───────────────────────────────────────

const EVENT_TYPE_OPTIONS = [
  { value: '会议', label: '会议' },
  { value: '聚餐', label: '聚餐' },
  { value: '提醒', label: '提醒' },
  { value: '其他', label: '其他' },
] as const;

function formatEventType(type: string | null | undefined): string {
  if (!type) return '';
  const option = EVENT_TYPE_OPTIONS.find((o) => o.value === type);
  return option?.label ?? type;
}

// ── Page ────────────────────────────────────────────

export function EventDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const navigate = useNavigate();

  // ── Fetch event ───────────────────────────────────

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
  });

  // ── Fetch contact (if linked) ─────────────────────

  const contactId = eventQuery.data?.contact_id ?? null;
  const contactQuery = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => adapter.contacts.get(contactId!),
    enabled: !!contactId,
  });

  // ── Delete mutation ───────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => adapter.events.delete(eventId),
    onSuccess: () => {
      navigate('/calendar');
    },
  });

  const handleDelete = () => {
    if (confirm('确定要删除这个日程吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  // ── Guards ────────────────────────────────────────

  if (eventQuery.isLoading) {
    return <div className="loading">…</div>;
  }

  if (eventQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载日程失败: {String(eventQuery.error)}</div>
      </div>
    );
  }

  const event = eventQuery.data!;

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <div>
          <h1 className="section__title">{event.title}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            {formatEventType(event.type)}
            {' · '}
            {new Date(event.start_at).toLocaleString('zh-CN')}
            {event.end_at ? ` – ${new Date(event.end_at).toLocaleString('zh-CN')}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link
            to={`/events/${id}/edit`}
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

      {/* Detail fields */}
      <section className="section">
        <div style={{ display: 'grid', gap: 12 }}>
          {event.location && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>地点</div>
              <div style={{ fontSize: 14 }}>📍 {event.location}</div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>关联联系人</div>
            {contactId ? (
              <Link
                className="inline-block mt-1 text-sm text-accent hover:underline"
                to={`/contacts/${contactId}`}
                style={{ marginTop: 2 }}
              >
                {contactQuery.data?.nickname ?? contactQuery.data?.name ?? '?'}
              </Link>
            ) : (
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>无</div>
            )}
          </div>
          {event.notes && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>备注</div>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 14,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--fg)',
                }}
              >
                {event.notes}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}