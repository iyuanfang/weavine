import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { StatusPicker, statusMeta } from '../components/StatusPicker';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Action, UpdateActionInput } from '../lib/adapter/types';

const PRIORITY_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '3', label: '高' },
  { value: '2', label: '中' },
  { value: '1', label: '低' },
  { value: '0', label: '无' },
] as const;

const PRIORITY_LABELS: Record<number, string> = { 0: '无', 1: '低', 2: '中', 3: '高' };

const PRIORITY_COLORS: Record<number, string> = {
  0: '#d1d5db',
  1: '#6b7280',
  2: '#f59e0b',
  3: '#ef4444',
};

const STATUS_ORDER = ['inbox', 'open', 'waiting', 'done'] as const;
type StatusKey = (typeof STATUS_ORDER)[number];

function useLocalStorageSet(key: string) {
  const [set, setSet] = useState<Set<string>>(() => {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  });

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify([...set]));
  }, [key, set]);

  return [set, setSet] as const;
}

export function ActionsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useLocalStorageSet('prm:actions:collapsed');

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

  const updateMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adapter.actions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
    },
  });

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
  const visible = priorityFilter === 'all'
    ? allActions
    : allActions.filter((a) => a.priority === Number(priorityFilter));

  const byStatus: Record<StatusKey, Action[]> = {
    inbox: [],
    open: [],
    waiting: [],
    done: [],
  };
  for (const a of visible) {
    if (a.status in byStatus) {
      byStatus[a.status as StatusKey].push(a);
    } else if (a.status === 'cancelled' || a.status === 'dropped') {
      byStatus.done.push(a);
    } else {
      byStatus.inbox.push(a);
    }
  }

  for (const key of STATUS_ORDER) {
    byStatus[key].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.due_at && b.due_at) {
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }
      if (a.due_at) return -1;
      if (b.due_at) return 1;
      return 0;
    });
  }

  const countsByPriority = PRIORITY_OPTIONS.reduce<Record<string, number>>((acc, p) => {
    acc[p.value] =
      p.value === 'all'
        ? allActions.length
        : allActions.filter((a) => a.priority === Number(p.value)).length;
    return acc;
  }, {});

  const totalActive = byStatus.inbox.length + byStatus.open.length + byStatus.waiting.length;
  const totalDone = byStatus.done.length;
  const overdueCount = [...byStatus.inbox, ...byStatus.open].filter((a) => {
    if (!a.due_at) return false;
    return new Date(a.due_at) < new Date();
  }).length;

  return (
    <div className="page">
      <PageHeader
        title="待办"
        subtitle={
          <>
            {totalActive} 个待处理 · {totalDone} 个已完成
            {overdueCount > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--danger)', fontWeight: 500 }}>
                {overdueCount} 已过期
              </span>
            )}
          </>
        }
        actions={
          <Link to="/actions/new" className="btn btn-primary">
            + 新建待办
          </Link>
        }
      />

      <div className="card" style={{ marginBottom: 20, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="text-xs text-muted" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
            优先级
          </span>
          {PRIORITY_OPTIONS.map((p) => {
            const active = priorityFilter === p.value;
            const dotColor = p.value === 'all' ? '#9ca3af' : PRIORITY_COLORS[Number(p.value)];
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriorityFilter(p.value)}
                className={`tag-chip ${active ? 'tag-chip--active' : ''}`}
                style={
                  active
                    ? { borderColor: dotColor, background: `${dotColor}18`, color: dotColor }
                    : undefined
                }
              >
                {p.label}
                <span className="filter-panel__count" style={{ marginLeft: 4 }}>
                  {countsByPriority[p.value] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {actionsQuery.isLoading ? (
        <div className="loading">加载中</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">
            {priorityFilter !== 'all' ? '没有匹配的待办' : '还没有待办'}
          </h3>
          <p className="empty-state__hint">
            {priorityFilter !== 'all'
              ? '试试切到「全部」优先级。'
              : '从一件具体的小事开始。'}
          </p>
          <Link to="/actions/new" className="btn btn-primary">
            + 新建待办
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {STATUS_ORDER.map((status) => {
            const items = byStatus[status];
            if (items.length === 0) return null;
            const meta = statusMeta(status);
            const isCollapsed = collapsed.has(status);
            const toggle = () => {
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(status)) next.delete(status);
                else next.add(status);
                return next;
              });
            };
            const overdueInSection = items.filter((a) => {
              if (!a.due_at) return false;
              return new Date(a.due_at) < new Date();
            }).length;

            return (
              <section key={status} className="section" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  onClick={toggle}
                  className="section__header"
                  style={{
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    width: '100%',
                    cursor: 'pointer',
                    marginBottom: isCollapsed ? 0 : 10,
                  }}
                >
                  <h2
                    className="section__title"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: status === 'done' ? 'var(--muted)' : 'var(--fg)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        transition: 'transform 160ms',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)',
                        fontSize: 11,
                        opacity: 0.6,
                      }}
                    >
                      ▼
                    </span>
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                    <span
                      className="badge badge--muted"
                      style={{ fontWeight: 500, marginLeft: 4 }}
                    >
                      {items.length}
                    </span>
                    {overdueInSection > 0 && (
                      <span
                        className="badge badge--danger"
                        style={{ fontSize: 10, padding: '1px 6px' }}
                      >
                        {overdueInSection} 过期
                      </span>
                    )}
                  </h2>
                </button>

                {!isCollapsed && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {items.map((a) => (
                      <ActionRow
                        key={a.id}
                        action={a}
                        contact={a.contact_id ? contactMap[a.contact_id] : null}
                        onToggleDone={() =>
                          updateMutation.mutate({
                            id: a.id,
                            status: a.status === 'done' ? 'open' : 'done',
                            completed_at:
                              a.status === 'done' ? null : new Date().toISOString(),
                          })
                        }
                        onChangeStatus={(newStatus) => {
                          updateMutation.mutate({
                            id: a.id,
                            status: newStatus,
                            completed_at:
                              newStatus === 'done' ? new Date().toISOString() : null,
                          });
                        }}
                        onDelete={() => {
                          if (confirm(`确定要删除「${a.title}」吗？`)) {
                            deleteMutation.mutate(a.id);
                          }
                        }}
                        isUpdating={
                          updateMutation.isPending && updateMutation.variables?.id === a.id
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  action,
  contact,
  onToggleDone,
  onChangeStatus,
  onDelete,
  isUpdating,
}: {
  action: Action;
  contact: { id: string; nickname: string; name: string | null } | null;
  onToggleDone: () => void;
  onChangeStatus: (status: string) => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const isDone = action.status === 'done';
  const displayName = contact ? (contact.nickname ?? contact.name ?? '?') : '';
  const [hovered, setHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [pressTimer, setPressTimer] = useState<number | null>(null);

  const onPressStart = () => {
    if (typeof window === 'undefined') return;
    const t = window.setTimeout(() => setHovered(true), 400);
    setPressTimer(t);
  };
  const onPressEnd = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  const dueDate = action.due_at ? new Date(action.due_at) : null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowEnd = new Date(todayStart.getTime() + 2 * 86400000);
  let dueLabel: string | null = null;
  let dueTone = '';
  if (dueDate) {
    if (dueDate < todayStart) {
      dueTone = 'overdue';
      dueLabel = `${dueDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 已过期`;
    } else if (dueDate < tomorrowEnd) {
      dueTone = 'today';
      dueLabel = `今天 ${dueDate.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    } else {
      dueLabel = dueDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }
  }

  const prioColor = PRIORITY_COLORS[action.priority] ?? '#d1d5db';

  return (
    <div
      ref={rowRef}
      className={`row-card ${dueTone ? `row-card--${dueTone}` : ''}`}
      style={{
        padding: '10px 14px',
        opacity: isDone ? 0.65 : 1,
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        onPressEnd();
      }}
      onTouchStart={onPressStart}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressEnd}
    >
      <button
        type="button"
        aria-label={isDone ? '标记未完成' : '标记完成'}
        disabled={isUpdating}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          border: `1.5px solid ${isDone ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: isDone ? 'var(--accent)' : '#fff',
          cursor: isUpdating ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          opacity: isUpdating ? 0.6 : 1,
          transition: `all var(--transition)`,
        }}
      >
        {isDone && '✓'}
      </button>

      <Link
        to={`/actions/${action.id}`}
        style={{
          flex: 1,
          minWidth: 0,
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            textDecoration: isDone ? 'line-through' : 'none',
            color: isDone ? 'var(--muted)' : 'var(--fg)',
          }}
        >
          {action.title}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
            flexWrap: 'wrap',
          }}
        >
          {action.priority > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: prioColor,
                }}
              />
              {PRIORITY_LABELS[action.priority]}
            </span>
          )}
          {dueLabel && (
            <>
              {action.priority > 0 && <span style={{ opacity: 0.4 }}>·</span>}
              <span
                style={{
                  color:
                    dueTone === 'overdue'
                      ? 'var(--danger)'
                      : dueTone === 'today'
                        ? 'var(--warn)'
                        : 'var(--muted)',
                  fontWeight: dueTone ? 500 : 400,
                }}
              >
                {dueLabel}
              </span>
            </>
          )}
          {displayName && (
            <>
              {(action.priority > 0 || dueLabel) && (
                <span style={{ opacity: 0.4 }}>·</span>
              )}
              <span style={{ color: 'var(--accent)' }}>{displayName}</span>
            </>
          )}
        </div>
      </Link>

      <StatusPicker value={action.status} onChange={onChangeStatus} compact />

      {(hovered || isDone === false) && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            opacity: hovered ? 1 : 0,
            transition: `opacity var(--transition)`,
          }}
        >
          <Link
            to={`/actions/${action.id}/edit`}
            className="btn btn-sm btn-ghost"
            style={{ padding: '4px 8px' }}
            title="编辑"
            onClick={(e) => e.stopPropagation()}
          >
            ✎
          </Link>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="btn btn-sm btn-ghost"
            style={{ padding: '4px 8px', color: 'var(--danger)' }}
            title="删除"
          >
            🗑
          </button>
        </div>
      )}
    </div>
  );
}