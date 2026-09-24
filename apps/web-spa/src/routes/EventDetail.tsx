import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { EVENT_PRESETS, categoryMeta } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { BacklinksPanel } from '../components/BacklinksPanel';
import { GraphTab } from '../components/GraphTab';
import { DetailHeaderCard, EntityIconBadge } from '../components/DetailHeaderCard';
import { ContactPickOrCreateModal } from '../components/ContactPickOrCreateModal';
import { useUserId } from '../lib/auth';
import { backTarget } from '../lib/backNavigation';

function formatEventType(type: string | null | undefined): string {
  if (!type) return '';
  const meta = categoryMeta(type, EVENT_PRESETS);
  return `${meta.icon} ${meta.label}`;
}

export function EventDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const userId = useUserId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const fromParam = searchParams.get('from');

  const back = backTarget(fromParam, '/calendar');
  const tab = searchParams.get('tab') === 'graph' ? 'graph' : 'detail';

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => adapter.events.delete(eventId),
    onSuccess: () => {
      // Required: navigate() remounts Calendar but the cached
      // ['events', userId] query is still fresh (staleTime: 30s), so the
      // calendar would keep showing the deleted event until F5.
      queryClient.invalidateQueries({ queryKey: ['events', userId] });
      navigate(fromParam || '/calendar');
    },
  });

  // Same semantics as the event form: contact_id mirrors the first
  // participant, so the event lands on the right person's timeline.
  const participantsMutation = useMutation({
    mutationFn: (ids: string[]) =>
      adapter.events.update({
        id,
        participant_contact_ids: ids.length > 0 ? ids : null,
        contact_id: ids[0] ?? null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', id] });
      queryClient.invalidateQueries({ queryKey: ['events', userId] });
    },
    onError: (e: unknown) => alert(`更新参与者失败：${e instanceof Error ? e.message : String(e)}`),
  });

  const [addingParticipants, setAddingParticipants] = useState(false);

  const handleAddParticipants = (ids: string[]) => {
    const existing = (eventQuery.data?.participants ?? []).map((p) => p.contact_id);
    const merged = [...existing, ...ids.filter((x) => !existing.includes(x))];
    setAddingParticipants(false);
    participantsMutation.mutate(merged);
  };

  const handleRemoveParticipant = (contactId: string) => {
    const existing = (eventQuery.data?.participants ?? []).map((p) => p.contact_id);
    participantsMutation.mutate(existing.filter((x) => x !== contactId));
  };

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
      <div className="page page--wide">
        <div className="error-banner">加载日程失败: {String(eventQuery.error)}</div>
      </div>
    );
  }

  const event = eventQuery.data!;
  const start = new Date(event.start_at);
  const end = event.end_at ? new Date(event.end_at) : null;

  return (
    <div className="page page--wide">
      <DetailHeaderCard
        icon={<EntityIconBadge>📅</EntityIconBadge>}
        title={event.title}
        badges={
          formatEventType(event.type) && (
            <span className="badge badge--muted">{formatEventType(event.type)}</span>
          )
        }
        meta={
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--muted)' }}>
            {start.toLocaleString('zh-CN')}
            {end && ` – ${end.toLocaleString('zh-CN')}`}
          </span>
        }
        actions={
          <>
            <Link to={back.href} className="btn btn-ghost">
              {back.label}
            </Link>
            <Link
              to={`/events/${id}/edit?from=${encodeURIComponent(fromParam || `/events/${id}`)}`}
              className="btn btn-secondary"
            >
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

      <GraphTab
        center={{ type: 'event', id }}
        creatable={['contact', 'project', 'event', 'action', 'note', 'interaction']}
        detailLabel="详情"
        graphLabel="🕸️ 关系图"
      />

      {tab === 'detail' && (
        <>
        <section className="section">
          <h2 className="section__title">基本信息</h2>
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '14px 24px',
            }}
          >
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
            <div>
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
        <div className="card" style={{ marginTop: 8, padding: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px 24px',
            }}
          >
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                参与者
                <button
                  type="button"
                  className="section__view-all"
                  data-testid="event-add-participant"
                  onClick={() => setAddingParticipants(true)}
                  style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
                >
                  + 添加参与者
                </button>
              </div>
              {event.participants && event.participants.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {event.participants.map((p) => (
                    <span key={p.contact_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <Link
                        to={`/contacts/${p.contact_id}`}
                        className="tag-chip tag-chip--active"
                        data-testid="event-participant"
                      >
                        {p.nickname ?? '?'}
                      </Link>
                      <button
                        type="button"
                        aria-label={`移除 ${p.nickname ?? '参与者'}`}
                        title="移除参与者"
                        disabled={participantsMutation.isPending}
                        onClick={() => handleRemoveParticipant(p.contact_id)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: 14,
                          padding: '0 2px',
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : eventQuery.data?.contact_id ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <Link
                    to={`/contacts/${eventQuery.data.contact_id}`}
                    className="tag-chip tag-chip--active"
                    data-testid="event-participant"
                  >
                    {eventQuery.data.contact_nickname ?? '?'}
                  </Link>
                  <button
                    type="button"
                    aria-label="移除联系人"
                    title="移除"
                    disabled={participantsMutation.isPending}
                    onClick={() => participantsMutation.mutate([])}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '0 2px',
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
            <div>
              <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                项目
              </div>
              {eventQuery.data?.project_id && eventQuery.data.project_title ? (
                <span
                  className="tag-chip tag-chip--active"
                  style={{ cursor: 'default' }}
                >
                  {eventQuery.data.project_title}
                </span>
              ) : (
                <span className="text-sm text-muted">—</span>
              )}
            </div>
          </div>
        </div>
      </section>
        </>
      )}

      <BacklinksPanel entityType="event" entityId={id} />

      {addingParticipants && (
        <ContactPickOrCreateModal
          title="添加参与者"
          confirmLabel="添加"
          excludeIds={(event.participants ?? []).map((p) => p.contact_id)}
          onConfirm={handleAddParticipants}
          onClose={() => setAddingParticipants(false)}
        />
      )}
    </div>
  );
}