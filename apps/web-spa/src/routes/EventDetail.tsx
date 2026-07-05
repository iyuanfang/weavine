import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { EVENT_PRESETS, categoryMeta } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';

function formatEventType(type: string | null | undefined): string {
  if (!type) return '';
  const meta = categoryMeta(type, EVENT_PRESETS);
  return `${meta.icon} ${meta.label}`;
}

export function EventDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const navigate = useNavigate();

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
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
            <span style={{ fontSize: 'var(--text-xl)' }}>📅</span>
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
            <Link to="/calendar" className="btn btn-ghost">
              ← 日历
            </Link>
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

      <section className="section">
        <h2 className="section__title">详情</h2>
        <div className="card" style={{ marginTop: 10, padding: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px 24px',
            }}
          >
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                类型
              </div>
              <div style={{ fontSize: 'var(--text-base)' }}>{formatEventType(event.type) || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                开始时间
              </div>
              <div style={{ fontSize: 'var(--text-base)' }}>{start.toLocaleString('zh-CN')}</div>
            </div>
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                结束时间
              </div>
              {end ? (
                <div style={{ fontSize: 'var(--text-base)' }}>{end.toLocaleString('zh-CN')}</div>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                提前提醒
              </div>
              {event.reminder_lead_minutes != null ? (
                <div style={{ fontSize: 'var(--text-base)' }}>⏰ {event.reminder_lead_minutes} 分钟</div>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                地点
              </div>
              {event.location ? (
                <div style={{ fontSize: 'var(--text-base)' }}>📍 {event.location}</div>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">关联</h2>
        <div className="card" style={{ marginTop: 10, padding: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px 24px',
            }}
          >
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                联系人
              </div>
              {eventQuery.data?.contact_id ? (
                <Link
                  to={`/contacts/${eventQuery.data.contact_id}`}
                  className="tag-chip tag-chip--active"
                >
                  {eventQuery.data.contact_nickname ?? '?'}
                </Link>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                项目
              </div>
              {eventQuery.data?.project_id && eventQuery.data.project_title ? (
                <Link
                  to={`/projects/${eventQuery.data.project_id}`}
                  className="tag-chip tag-chip--active"
                >
                  {eventQuery.data.project_title}
                </Link>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">备注</h2>
        <div className="card" style={{ marginTop: 10, padding: 16, minHeight: 60 }}>
          {event.notes ? (
            <p style={{ margin: 0, fontSize: 'var(--text-base)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {event.notes}
            </p>
          ) : (
            <span className="text-sm text-muted">暂无备注</span>
          )}
        </div>
      </section>
    </div>
  );
}