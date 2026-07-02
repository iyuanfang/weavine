import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Action, UpdateActionInput } from '../lib/adapter/types';

const STATUS_LABEL: Record<string, string> = {
  inbox: '📥 收件箱',
  open: '🔨 进行中',
  waiting: '⏳ 等待中',
  done: '✅ 已完成',
  cancelled: '🗑 已取消',
  dropped: '🗑 已放弃',
};

const STATUS_DOT: Record<string, string> = {
  inbox: '#6b7280',
  open: '#3b82f6',
  waiting: '#f59e0b',
  done: '#10b981',
  cancelled: '#9ca3af',
  dropped: '#9ca3af',
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

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'inbox', label: '收件箱' },
  { value: 'open', label: '进行中' },
  { value: 'waiting', label: '等待中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

const PRIORITY_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '3', label: '高' },
  { value: '2', label: '中' },
  { value: '1', label: '低' },
  { value: '0', label: '无' },
];

export function ActionsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const actionsQuery = useQuery({
    queryKey: ['actions', ownerId],
    queryFn: () =>
      adapter.actions.list({
        owner_id: ownerId!,
        limit: 500,
      }),
    enabled: !!ownerId,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contactMap = (contactsQuery.data ?? []).reduce<
    Record<string, { id: string; nickname: string; name: string | null }>
  >((acc, c) => {
    acc[c.id] = { id: c.id, nickname: c.nickname, name: c.name };
    return acc;
  }, {});

  const completeMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
    },
  });

  const handleComplete = (actionId: string) => {
    completeMutation.mutate({
      id: actionId,
      status: 'done',
      completed_at: new Date().toISOString(),
    });
  };

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (actionsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载待办失败: {String(actionsQuery.error)}</div>
      </div>
    );
  }

  const allActions = actionsQuery.data ?? [];
  let filtered = allActions;

  if (statusFilter !== 'all') {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }
  if (priorityFilter !== 'all') {
    filtered = filtered.filter((a) => a.priority === Number(priorityFilter));
  }

  filtered = [...filtered].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.due_at && b.due_at) {
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    }
    if (a.due_at) return -1;
    if (b.due_at) return 1;
    return 0;
  });

  const countsByStatus = STATUS_FILTERS.reduce<Record<string, number>>((acc, s) => {
    acc[s.value] = s.value === 'all' ? allActions.length : allActions.filter((a) => a.status === s.value).length;
    return acc;
  }, {});

  const countsByPriority = PRIORITY_FILTERS.reduce<Record<string, number>>((acc, p) => {
    acc[p.value] =
      p.value === 'all'
        ? allActions.length
        : allActions.filter((a) => a.priority === Number(p.value)).length;
    return acc;
  }, {});

  const hasActiveFilter = statusFilter !== 'all' || priorityFilter !== 'all';
  const clearAll = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(today.getTime() + 86400000);

  return (
    <div className="page">
      <PageHeader
        title="待办"
        subtitle={
          <>
            {filtered.length} 个
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearAll}
                className="btn-ghost"
                style={{ fontSize: 12, padding: '0 4px', color: 'var(--accent)' }}
              >
                清除筛选
              </button>
            )}
          </>
        }
        actions={
          <Link to="/actions/new" className="btn btn-primary">
            + 新建待办
          </Link>
        }
      />

      <div className="layout-split">
        <aside className="filter-panel">
          <div className="filter-panel__section">
            <div className="filter-panel__title">状态</div>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(s.value)}
                className={`filter-panel__item ${
                  statusFilter === s.value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="filter-panel__item-dot"
                    style={{ background: STATUS_DOT[s.value] ?? '#9ca3af' }}
                  />
                  <span>{s.label}</span>
                </span>
                <span className="filter-panel__count">{countsByStatus[s.value] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="filter-panel__divider" />

          <div className="filter-panel__section">
            <div className="filter-panel__title">优先级</div>
            {PRIORITY_FILTERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriorityFilter(p.value)}
                className={`filter-panel__item ${
                  priorityFilter === p.value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="filter-panel__item-dot"
                    style={{ background: PRIORITY_BADGE[Number(p.value)]?.fg ?? '#9ca3af' }}
                  />
                  <span>{p.label}</span>
                </span>
                <span className="filter-panel__count">{countsByPriority[p.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="layout-split__main">
          {actionsQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">
                {hasActiveFilter ? '没有匹配的待办' : '还没有待办'}
              </h3>
              <p className="empty-state__hint">
                {hasActiveFilter
                  ? '试着清空筛选条件。'
                  : '从一件具体的小事开始。'}
              </p>
              <Link to="/actions/new" className="btn btn-primary">
                {hasActiveFilter ? '+ 新建待办' : '+ 添加第一个待办'}
              </Link>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {filtered.map((a) => (
                <ActionRow
                  key={a.id}
                  action={a}
                  contact={a.contact_id ? contactMap[a.contact_id] : null}
                  today={today}
                  endOfToday={endOfToday}
                  onComplete={handleComplete}
                  isCompleting={completeMutation.variables?.id === a.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionRow({
  action,
  contact,
  today,
  endOfToday,
  onComplete,
  isCompleting,
}: {
  action: Action;
  contact: { id: string; nickname: string; name: string | null } | null;
  today: Date;
  endOfToday: Date;
  onComplete: (actionId: string) => void;
  isCompleting: boolean;
}) {
  let dueTone = '';
  let dueLabel = '';
  if (action.due_at) {
    const due = new Date(action.due_at);
    if (due < today) {
      dueTone = 'overdue';
      dueLabel = `过期 ${due.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
    } else if (due < endOfToday) {
      dueTone = 'today';
      dueLabel = `今天 ${due.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
    } else {
      dueLabel = due.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }
  }

  const statusLabel = STATUS_LABEL[action.status] ?? action.status;
  const prioLabel = PRIORITY_LABELS[action.priority] ?? '';
  const prio = PRIORITY_BADGE[action.priority] ?? PRIORITY_BADGE[0];
  const displayName = contact ? (contact.nickname ?? contact.name ?? '?') : '';

  return (
    <div className={`row-card ${dueTone ? `row-card--${dueTone}` : ''}`}>
      <button
        type="button"
        aria-label="标记完成"
        disabled={action.status === 'done' || isCompleting}
        onClick={(e) => {
          e.stopPropagation();
          onComplete(action.id);
        }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          border: `1.5px solid ${action.status === 'done' ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: action.status === 'done' ? 'var(--accent)' : '#fff',
          cursor: action.status === 'done' ? 'default' : 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          opacity: isCompleting ? 0.6 : 1,
          transition: `all var(--transition)`,
        }}
      >
        {action.status === 'done' && '✓'}
      </button>

      <Link
        to={`/actions/${action.id}`}
        style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            textDecoration: action.status === 'done' ? 'line-through' : 'none',
            color: action.status === 'done' ? 'var(--muted)' : 'var(--fg)',
          }}
        >
          {action.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          {statusLabel}
          {dueLabel && <span style={{ margin: '0 6px' }}>·</span>}
          {dueLabel}
          {displayName && (
            <>
              <span style={{ margin: '0 6px' }}>·</span>
              <span style={{ color: 'var(--accent)' }}>{displayName}</span>
            </>
          )}
        </div>
      </Link>

      {prioLabel && action.priority > 0 && (
        <span className="badge" style={{ background: prio.bg, color: prio.fg }}>
          {prioLabel}
        </span>
      )}

      <Link
        to={`/actions/${action.id}/edit`}
        style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}
        title="编辑"
      >
        ✎
      </Link>
    </div>
  );
}