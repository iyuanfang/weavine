import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { InteractionSourceTag } from '../components/InteractionSourceTag';
import { BacklinksPanel } from '../components/BacklinksPanel';
import { GraphTab } from '../components/GraphTab';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';

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

// datetime-local needs YYYY-MM-DDTHH:mm in local time, no timezone marker.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert local datetime-local string back to ISO. The browser interprets the
// string as local time, which is what we want (the user picked a local moment).
function fromLocalInputValue(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

export function InteractionDetail() {
  const { id } = useParams() as { id: string };
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from');
  const adapter = useAdapter();
  const userId = useUserId();
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

  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState('');
  const [editOccurredAt, setEditOccurredAt] = useState('');
  const [editChannel, setEditChannel] = useState('');
  const [tab, setTab] = useState<'detail' | 'graph'>('detail');

  // Seed edit fields when entering edit mode (or when the interaction loads).
  useEffect(() => {
    if (interactionQuery.data && editing) {
      setEditSummary(interactionQuery.data.summary ?? '');
      setEditOccurredAt(toLocalInputValue(interactionQuery.data.occurred_at));
      setEditChannel(interactionQuery.data.channel ?? '');
    }
  }, [interactionQuery.data, editing]);

  const updateMutation = useMutation({
    mutationFn: () =>
      adapter.interactions.update({
        id,
        summary: editSummary,
        occurred_at: fromLocalInputValue(editOccurredAt),
        channel: editChannel.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interaction', id] });
      if (contactQuery.data) {
        queryClient.invalidateQueries({
          queryKey: ['interactions', userId, 'for-contact', contactQuery.data.id],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ['interactions', userId, 'recent-for-today'],
      });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (interactionId: string) => adapter.interactions.delete(interactionId),
    onSuccess: () => {
      if (contactQuery.data) {
        queryClient.invalidateQueries({
          queryKey: ['interactions', userId, 'for-contact', contactQuery.data.id],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ['interactions', userId, 'recent-for-today'],
      });
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

  const handleStartEdit = () => {
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSummary.trim()) return;
    updateMutation.mutate();
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

  const backHref = from ?? (contact ? `/contacts/${contact.id}` : '/contacts');
  const backLabel = from === '/today' ? '← 今天' : contact ? '← 联系人' : '← 联系人列表';

  return (
    <div className="page">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--text-xl)' }}>💬</span>
            互动记录
          </span>
        }
        subtitle={formatDateTime(new Date(interaction.occurred_at))}
        back={<Link to={backHref} className="btn btn-ghost">{backLabel}</Link>}
        actions={
          !editing ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleStartEdit}
                className="btn btn-secondary"
              >
                编辑
              </button>
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
          ) : (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="btn btn-ghost"
              disabled={updateMutation.isPending}
            >
              取消
            </button>
          )
        }
      />

      <GraphTab
        activeTab={tab}
        onTabChange={setTab}
        center={{ type: 'interaction', id: id as string }}
        creatable={[]}
        detailLabel="详情"
        graphLabel="🕸️ 关系图"
      />

      {tab === 'detail' && (editing ? (
        <form onSubmit={handleSaveEdit}>
          <section className="section">
            <h2 className="section__title">编辑</h2>
            <div className="card" style={{ marginTop: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>时间</span>
                <input
                  type="datetime-local"
                  value={editOccurredAt}
                  onChange={(e) => setEditOccurredAt(e.target.value)}
                  className="input-base"
                  data-testid="interaction-occurred-at"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>渠道</span>
                <select
                  value={editChannel}
                  onChange={(e) => setEditChannel(e.target.value)}
                  className="input-base"
                  data-testid="interaction-channel"
                >
                  <option value="">无</option>
                  <option value="微信">微信</option>
                  <option value="电话">电话</option>
                  <option value="邮件">邮件</option>
                  <option value="见面">见面</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>摘要</span>
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  className="input-base"
                  rows={3}
                  data-testid="interaction-summary"
                />
              </label>
              {updateMutation.isError && (
                <div role="alert" style={{ color: '#dc2626', fontSize: 'var(--text-sm)' }}>
                  保存失败: {String(updateMutation.error)}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn btn-ghost"
                  disabled={updateMutation.isPending}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={updateMutation.isPending || !editSummary.trim()}
                >
                  {updateMutation.isPending ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </section>
        </form>
      ) : (
        <>
          {interaction.channel && (
            <section className="section">
              <h2 className="section__title">渠道</h2>
              <div className="card" style={{ marginTop: 10, padding: 16 }}>
                <span className="badge badge--accent">{interaction.channel}</span>
              </div>
            </section>
          )}

          {interaction.source && interaction.source !== 'manual' && (
            <section className="section">
              <h2 className="section__title">来源</h2>
              <div className="card" style={{ marginTop: 10, padding: 16 }}>
                <InteractionSourceTag source={interaction.source} />
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
        </>
      ))}

      {(contact || event || action) && (
        <section className="section">
          <h2 className="section__title">关联记录</h2>
          <div className="card" style={{ marginTop: 10, padding: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contact && (
                <Link
                  to={`/contacts/${contact.id}?from=/interactions/${id}`}
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

      <BacklinksPanel entityType="interaction" entityId={id} />
    </div>
  );
}