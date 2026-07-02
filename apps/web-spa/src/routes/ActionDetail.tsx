import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { UpdateActionInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  inbox: '📥 收件箱',
  open: '🔨 进行中',
  waiting: '⏳ 等待中',
  done: '✅ 已完成',
  cancelled: '🗑 已取消',
  dropped: '🗑 已放弃',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: '无',
  1: '低',
  2: '中',
  3: '高',
};

const PRIORITY_BADGE_COLORS: Record<string, string> = {
  3: '#ef4444',
  2: '#f59e0b',
  1: '#6b7280',
  0: '#d1d5db',
};

// ── Page ────────────────────────────────────────────

export function ActionDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Fetch action ──────────────────────────────────

  const actionQuery = useQuery({
    queryKey: ['action', id],
    queryFn: () => adapter.actions.get(id),
  });

  // ── Fetch contact (for link) ──────────────────────

  const contactQuery = useQuery({
    queryKey: ['contacts', ownerId, 'all'],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contactMap = (contactQuery.data ?? []).reduce<Record<string, { id: string; nickname: string; name: string | null }>>(
    (acc, c) => {
      acc[c.id] = { id: c.id, nickname: c.nickname, name: c.name };
      return acc;
    },
    {},
  );

  // ── Fetch event (for link) ────────────────────────

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => adapter.events.get(id),
    enabled: !!ownerId,
  });

  // ── Complete mutation ─────────────────────────────

  const completeMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      queryClient.invalidateQueries({ queryKey: ['action', id] });
    },
  });

  // ── Cancel mutation ───────────────────────────────

  const cancelMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      queryClient.invalidateQueries({ queryKey: ['action', id] });
    },
  });

  // ── Delete mutation ───────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (actionId: string) => adapter.actions.delete(actionId),
    onSuccess: () => {
      navigate('/actions');
    },
  });

  const handleDelete = () => {
    if (confirm('确定要删除这个待办吗？此操作不可恢复。')) {
      deleteMutation.mutate(id);
    }
  };

  const handleComplete = () => {
    completeMutation.mutate({
      id,
      status: 'done',
      completed_at: new Date().toISOString(),
    });
  };

  const handleCancel = () => {
    cancelMutation.mutate({
      id,
      status: 'cancelled',
    });
  };

  // ── Guard ─────────────────────────────────────────

  if (actionQuery.isLoading) {
    return <div className="loading">…</div>;
  }

  if (actionQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载待办失败: {String(actionQuery.error)}</div>
      </div>
    );
  }

  const action = actionQuery.data!;
  const contact = action.contact_id ? contactMap[action.contact_id] : null;
  const event = action.event_id ? eventQuery.data ?? null : null;

  // ── Derived ───────────────────────────────────────

  const statusLabel = STATUS_LABEL[action.status] ?? action.status;
  const prioLabel = PRIORITY_LABELS[action.priority] ?? '';
  const prioColor = PRIORITY_BADGE_COLORS[String(action.priority)] ?? '#d1d5db';

  const isDone = action.status === 'done';
  const isCancelled = action.status === 'cancelled';

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <div style={{ flex: 1 }}>
          <h1 className="section__title">{action.title}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            {statusLabel}
            {prioLabel && (
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: 4,
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: `${prioColor}18`,
                  color: prioColor,
                  fontWeight: 500,
                  verticalAlign: 'middle',
                }}
              >
                P{action.priority}
              </span>
            )}
            {action.due_at && (
              <span style={{ marginLeft: 4 }}>
                · {new Date(action.due_at).toLocaleString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Link
            to={`/actions/${id}/edit`}
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
        </div>
      </div>

      {/* Description */}
      {action.description && (
        <section className="section">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>描述</div>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--fg)' }}>
            {action.description}
          </p>
        </section>
      )}

      {/* Info fields */}
      <section className="section">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px 16px',
          }}
        >
          {action.category && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>分类</div>
              <div style={{ fontSize: 14 }}>{action.category}</div>
            </div>
          )}

          {contact && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>我答应</div>
              <div style={{ fontSize: 14 }}>
                <Link
                  to={`/contacts/${contact.id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {contact.nickname ?? contact.name ?? '?'}
                </Link>
              </div>
            </div>
          )}

          {event && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>关联日程</div>
              <div style={{ fontSize: 14 }}>
                <Link
                  to={`/events/${event.id}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none' }}
                >
                  {event.title}
                </Link>
              </div>
            </div>
          )}

          {action.completed_at && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>完成时间</div>
              <div style={{ fontSize: 14 }}>
                {new Date(action.completed_at).toLocaleString('zh-CN')}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Action buttons */}
      {!isDone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            onClick={handleComplete}
            disabled={completeMutation.isPending}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 8,
              background: '#10b981',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: completeMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: completeMutation.isPending ? 0.6 : 1,
            }}
          >
            {completeMutation.isPending ? '完成中…' : '完成'}
          </button>

          {!isCancelled && (
            <button
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              style={{
                padding: '8px 20px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: '#fff',
                color: 'var(--fg)',
                fontSize: 14,
                fontWeight: 500,
                cursor: cancelMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: cancelMutation.isPending ? 0.6 : 1,
              }}
            >
              {cancelMutation.isPending ? '取消中…' : '取消'}
            </button>
          )}

          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderRadius: 8,
              background: '#ef4444',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: deleteMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: deleteMutation.isPending ? 0.6 : 1,
            }}
          >
            {deleteMutation.isPending ? '删除中…' : '删除'}
          </button>
        </div>
      )}
    </div>
  );
}