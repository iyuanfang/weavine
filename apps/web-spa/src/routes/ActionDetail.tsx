import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { UpdateActionInput } from '../lib/adapter/types';

const STATUS_LABEL: Record<string, string> = {
  inbox: '📥 收件箱',
  open: '🔨 进行中',
  waiting: '⏳ 等待中',
  done: '✅ 已完成',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: '无',
  1: '低',
  2: '中',
  3: '高',
};

const PRIORITY_BADGE: Record<number, { bg: string; fg: string }> = {
  0: { bg: '#f3f4f6', fg: '#6b7280' },
  1: { bg: '#f3f4f6', fg: '#6b7280' },
  2: { bg: '#fffbeb', fg: '#d97706' },
  3: { bg: '#fef2f2', fg: '#dc2626' },
};

export function ActionDetail() {
  const { id } = useParams() as { id: string };
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const actionQuery = useQuery({
    queryKey: ['action', id],
    queryFn: () => adapter.actions.get(id),
  });

  const contactQuery = useQuery({
    queryKey: ['contacts', ownerId, 'all'],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contactMap = (contactQuery.data ?? []).reduce<
    Record<string, { id: string; nickname: string; name: string | null }>
  >((acc, c) => {
    acc[c.id] = { id: c.id, nickname: c.nickname, name: c.name };
    return acc;
  }, {});

  const completeMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
      queryClient.invalidateQueries({ queryKey: ['action', id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (actionId: string) => adapter.actions.delete(actionId),
    onSuccess: () => navigate('/actions'),
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

  const handleReopen = () => {
    completeMutation.mutate({
      id,
      status: 'open',
      completed_at: null,
    });
  };

  if (actionQuery.isLoading) {
    return <div className="loading">加载中</div>;
  }

  if (actionQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载待办失败: {String(actionQuery.error)}</div>
      </div>
    );
  }

  const action = actionQuery.data!;
  const contact = action.contact_id ? contactMap[action.contact_id] : null;
  const statusLabel = STATUS_LABEL[action.status] ?? action.status;
  const prio = PRIORITY_BADGE[action.priority] ?? PRIORITY_BADGE[0];
  const prioLabel = PRIORITY_LABELS[action.priority] ?? '';
  const isDone = action.status === 'done';

  return (
    <div className="page page--narrow">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 24 }}>{isDone ? '✅' : '📌'}</span>
            <span
              style={{
                textDecoration: isDone ? 'line-through' : 'none',
                color: isDone ? 'var(--muted)' : 'inherit',
              }}
            >
              {action.title}
            </span>
          </span>
        }
        subtitle={
          <>
            {statusLabel}
            {action.priority > 0 && (
              <span
                className="badge"
                style={{ background: prio.bg, color: prio.fg, marginLeft: 8 }}
              >
                {prioLabel}
              </span>
            )}
            {action.due_at && (
              <span style={{ marginLeft: 8 }}>
                · 截止 {new Date(action.due_at).toLocaleString('zh-CN')}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Link to="/actions" className="btn btn-ghost">
              ← 待办列表
            </Link>
            <Link to={`/actions/${id}/edit`} className="btn btn-secondary">
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

      {action.description && (
        <section className="section">
          <h2 className="section__title">描述</h2>
          <div className="card" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {action.description}
            </p>
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">详情</h2>
        <div className="card" style={{ marginTop: 10, padding: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px 24px',
            }}
          >
            {action.category && (
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 2 }}>
                  分类
                </div>
                <div style={{ fontSize: 14 }}>{action.category}</div>
              </div>
            )}
            {contact && (
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 2 }}>
                  关联联系人
                </div>
                <div style={{ fontSize: 14 }}>
                  <Link to={`/contacts/${contact.id}`} className="tag-chip tag-chip--active">
                    {contact.nickname ?? contact.name ?? '?'}
                  </Link>
                </div>
              </div>
            )}
            {action.completed_at && (
              <div>
                <div className="text-xs text-muted" style={{ marginBottom: 2 }}>
                  完成时间
                </div>
                <div style={{ fontSize: 14 }}>
                  {new Date(action.completed_at).toLocaleString('zh-CN')}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {!isDone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleComplete}
            disabled={completeMutation.isPending}
            className="btn btn-primary"
            style={{
              background: 'var(--success)',
              opacity: completeMutation.isPending ? 0.6 : 1,
            }}
          >
            {completeMutation.isPending ? '完成中…' : '✓ 标记完成'}
          </button>
        </div>
      )}

      {isDone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleReopen}
            disabled={completeMutation.isPending}
            className="btn btn-secondary"
            style={{ opacity: completeMutation.isPending ? 0.6 : 1 }}
          >
            {completeMutation.isPending ? '处理中…' : '↺ 重新打开'}
          </button>
        </div>
      )}
    </div>
  );
}