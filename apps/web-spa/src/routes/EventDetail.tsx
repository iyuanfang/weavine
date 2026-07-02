import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';

const EVENT_TYPE_LABEL: Record<string, string> = {
  会议: '🤝 会议',
  聚餐: '🍽 聚餐',
  提醒: '⏰ 提醒',
  生日: '🎂 生日',
  其他: '📌 其他',
};

function formatEventType(type: string | null | undefined): string {
  if (!type) return '';
  return EVENT_TYPE_LABEL[type] ?? type;
}

export function EventDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const navigate = useNavigate();

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
  });

  const contactId = eventQuery.data?.contact_id ?? null;
  const contactQuery = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => adapter.contacts.get(contactId!),
    enabled: !!contactId,
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => adapter.events.delete(eventId),
    onSuccess: () => navigate('/calendar'),
  });

  const handleDelete = () => {
    if (confirm('确定要删除这个日程吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  if (eventQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

  if (eventQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载日程失败: {String(eventQuery.error)}</div>
      </div>
    );
  }

  const event = eventQuery.data!;
  const start = new Date(event.start_at);
  const end = event.end_at ? new Date(event.end_at) : null;

  return (
    <div className="page page--narrow">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 24 }}>📅</span>
            {event.title}
          </span>
        }
        subtitle={
          <>
            {formatEventType(event.type)} · {start.toLocaleString('zh-CN')}
            {end && ` – ${end.toLocaleString('zh-CN')}`}
          </>
        }
        actions={
          <>
            <Link to={`/events/${id}/edit`} className="btn btn-secondary">
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
          </>
        }
      />

      {event.location && (
        <section className="section">
          <h2 className="section__title">地点</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div style={{ fontSize: 14 }}>📍 {event.location}</div>
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">关联</h2>
        <div className="card" style={{ marginTop: 10, padding: 16 }}>
          <div className="text-xs text-muted" style={{ marginBottom: 6 }}>
            联系人
          </div>
          {contactId ? (
            <Link
              to={`/contacts/${contactId}`}
              className="tag-chip"
              style={{
                background: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                textDecoration: 'none',
              }}
            >
              {contactQuery.data?.nickname ?? contactQuery.data?.name ?? '?'}
            </Link>
          ) : (
            <div className="text-sm text-muted">无</div>
          )}
        </div>
      </section>

      {event.notes && (
        <section className="section">
          <h2 className="section__title">备注</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {event.notes}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}