import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';

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

export function InteractionDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const interactionQuery = useQuery({
    queryKey: ['interaction', id],
    queryFn: () => adapter.interactions.get(id),
  });

  const contactQuery = useQuery({
    queryKey: ['contact', interactionQuery.data?.contact_id],
    queryFn: () =>
      adapter.contacts.get(interactionQuery.data!.contact_id!),
    enabled: !!interactionQuery.data?.contact_id,
  });

  const eventQuery = useQuery({
    queryKey: ['event', interactionQuery.data?.event_id],
    queryFn: () => adapter.events.get(interactionQuery.data!.event_id!),
    enabled: !!interactionQuery.data?.event_id,
  });

  const actionQuery = useQuery({
    queryKey: ['action', interactionQuery.data?.action_id],
    queryFn: () => adapter.actions.get(interactionQuery.data!.action_id!),
    enabled: !!interactionQuery.data?.action_id,
  });

  const deleteMutation = useMutation({
    mutationFn: (interactionId: string) => adapter.interactions.delete(interactionId),
    onSuccess: () => {
      if (contactQuery.data) {
        queryClient.invalidateQueries({
          queryKey: ['interactions', ownerId, 'for-contact', contactQuery.data.id],
        });
      }
      if (contactQuery.data) {
        navigate(`/contacts/${contactQuery.data.id}`);
      } else {
        navigate('/contacts');
      }
    },
  });

  const handleDelete = () => {
    if (confirm('确定要删除这条互动记录吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  if (interactionQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

  if (interactionQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载互动失败: {String(interactionQuery.error)}</div>
      </div>
    );
  }

  const interaction = interactionQuery.data!;
  const contact = contactQuery.data ?? null;
  const event = eventQuery.data ?? null;
  const action = actionQuery.data ?? null;

  return (
    <div className="page page--narrow">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--text-xl)' }}>💬</span>
            互动记录
          </span>
        }
        subtitle={formatDateTime(new Date(interaction.occurred_at))}
        back={
          contact ? (
            <Link to={`/contacts/${contact.id}`} className="btn btn-ghost">
              ← 联系人
            </Link>
          ) : undefined
        }
        actions={
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="btn btn-danger"
            style={{ opacity: deleteMutation.isPending ? 0.6 : 1 }}
          >
            {deleteMutation.isPending ? '删除中…' : '删除'}
          </button>
        }
      />

      {interaction.channel && (
        <section className="section">
          <h2 className="section__title">渠道</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <span className="badge badge--accent">{interaction.channel}</span>
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">摘要</h2>
        <div className="card" style={{ marginTop: 10 }}>
          <p style={{ margin: 0, fontSize: 'var(--text-base)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {interaction.summary}
          </p>
        </div>
      </section>

      {(contact || event || action) && (
        <section className="section">
          <h2 className="section__title">关联记录</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contact && (
                <Link
                  to={`/contacts/${contact.id}`}
                  className="tag-chip tag-chip--active"
                  style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
                >
                  👤 {contact.nickname ?? contact.name ?? '?'}
                </Link>
              )}
              {event && (
                <Link
                  to={`/events/${event.id}?from=/interactions/${id}`}
                  className="tag-chip tag-chip--active"
                  style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
                >
                  📅 {event.title}
                </Link>
              )}
              {action && (
                <Link
                  to={`/actions/${action.id}?from=/interactions/${id}`}
                  className="tag-chip tag-chip--active"
                  style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
                >
                  ☑ {action.title}
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}