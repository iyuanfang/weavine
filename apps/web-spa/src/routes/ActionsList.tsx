import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { statusMeta } from '../components/StatusPicker';
import { priorityMeta } from '../components/PriorityPicker';
import { categoryMeta, ACTION_PRESETS } from '../components/categoryPresets';
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

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useLocalStorageSet('prm:actions:collapsed');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<StatusKey | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const actionsQuery = useQuery({
    queryKey: ['actions', ownerId],
    queryFn: () =>
      adapter.actions.list({
        owner_id: ownerId!,
        limit: 500,
      }),
    enabled: !!ownerId,
    refetchOnMount: 'always',
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
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['actions', ownerId] });
      const prev = queryClient.getQueryData<Action[]>(['actions', ownerId]);
      if (prev) {
        queryClient.setQueryData<Action[]>(['actions', ownerId], (old) =>
          (old ?? []).map((a) =>
            a.id === input.id
              ? {
                  ...a,
                  status: input.status ?? a.status,
                  priority: input.priority ?? a.priority,
                  completed_at:
                    input.completed_at !== undefined ? input.completed_at : a.completed_at,
                }
              : a,
          ),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['actions', ownerId], ctx.prev);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Action[]>(['actions', ownerId], (old) =>
        (old ?? []).map((a) => (a.id === data.id ? data : a)),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adapter.actions.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['actions', ownerId] });
      const prev = queryClient.getQueryData<Action[]>(['actions', ownerId]);
      if (prev) {
        queryClient.setQueryData<Action[]>(['actions', ownerId], (old) =>
          (old ?? []).filter((a) => a.id !== id),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['actions', ownerId], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', ownerId] });
    },
  });

  const handleDragStart = (e: React.DragEvent, actionId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', actionId);
    setDraggingId(actionId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStatus(null);
  };

  const handleDragOver = (e: React.DragEvent, status: StatusKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStatus !== status) setDragOverStatus(status);
  };

  const handleDragLeave = (e: React.DragEvent, status: StatusKey) => {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    if (dragOverStatus === status) setDragOverStatus(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: StatusKey) => {
    e.preventDefault();
    const actionId = e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDragOverStatus(null);
    if (!actionId) return;
    const action = allActions.find((a) => a.id === actionId);
    if (!action || action.status === targetStatus) return;
    updateMutation.mutate({
      id: actionId,
      status: targetStatus,
      completed_at: targetStatus === 'done' ? new Date().toISOString() : null,
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
  const visible = allActions
    .filter((a) => priorityFilter === 'all' || a.priority === Number(priorityFilter))
    .filter((a) => {
      if (!debouncedSearch) return true;
      const haystack = [
        a.title,
        a.description ?? '',
        a.category ?? '',
        a.contact_id ? contactMap[a.contact_id]?.nickname ?? '' : '',
        a.contact_id ? contactMap[a.contact_id]?.name ?? '' : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(debouncedSearch);
    });

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

  const countsByStatus: Record<string, number> = {
    all: allActions.length,
    inbox: byStatus.inbox.length,
    open: byStatus.open.length,
    waiting: byStatus.waiting.length,
    done: byStatus.done.length,
  };

  const totalActive =
    byStatus.inbox.length + byStatus.open.length + byStatus.waiting.length;
  const totalDone = byStatus.done.length;
  const overdueCount = [...byStatus.inbox, ...byStatus.open].filter((a) => {
    if (!a.due_at) return false;
    return new Date(a.due_at) < new Date();
  }).length;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const doneTodayCount = byStatus.done.filter((a) => {
    if (!a.completed_at) return false;
    return new Date(a.completed_at) >= todayStart;
  }).length;
  const todayProgress = totalActive + doneTodayCount > 0
    ? Math.round((doneTodayCount / (totalActive + doneTodayCount)) * 100)
    : 0;

  const panel = (
    <>
      <div className="filter-panel__section">
        <input
          type="text"
          className="input-base"
          placeholder="🔍 搜索待办、联系人…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">状态</div>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="filter-panel__item"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>●</span>
            <span>展开全部</span>
          </span>
        </button>
        {STATUS_ORDER.map((s) => {
          const meta = statusMeta(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  STATUS_ORDER.forEach((k) => {
                    if (k !== s) next.add(k);
                  });
                  next.delete(s);
                  return next;
                });
              }}
              className="filter-panel__item"
              style={{ opacity: collapsed.has(s) ? 0.55 : 1 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="filter-panel__item-dot"
                  style={{ background: meta.color }}
                />
                <span>{meta.label}</span>
              </span>
              <span className="filter-panel__count">{countsByStatus[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">优先级</div>
        {PRIORITY_OPTIONS.map((p) => {
          const active = priorityFilter === p.value;
          const dotColor = p.value === 'all' ? '#9ca3af' : PRIORITY_COLORS[Number(p.value)];
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setPriorityFilter(p.value)}
              className={`filter-panel__item ${active ? 'filter-panel__item--active' : ''}`}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className="filter-panel__item-dot"
                  style={{ background: dotColor }}
                />
                <span>{p.label}</span>
              </span>
              <span className="filter-panel__count">{countsByPriority[p.value] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <div className="filter-panel__title">今天进度</div>
        <div
          style={{
            padding: '4px 10px',
            fontSize: 13,
            color: 'var(--fg-soft)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span>已完成 {doneTodayCount}</span>
            <span style={{ color: 'var(--muted)' }}>{todayProgress}%</span>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--bg-subtle)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${todayProgress}%`,
                height: '100%',
                background:
                  todayProgress >= 80
                    ? 'var(--success)'
                    : todayProgress >= 40
                      ? 'var(--warn)'
                      : 'var(--accent)',
                transition: `width 320ms cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
            />
          </div>
          {overdueCount > 0 && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: 'var(--danger)',
                fontWeight: 500,
              }}
            >
              ⚠ {overdueCount} 个已过期
            </div>
          )}
        </div>
      </div>
    </>
  );

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

      <div className="layout-split">
        <aside className="filter-panel">{panel}</aside>

        <div className="layout-split__main">
          {actionsQuery.isLoading ? (
            <div className="loading">加载中</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">
                {search || priorityFilter !== 'all' ? '没有匹配的待办' : '还没有待办'}
              </h3>
              <p className="empty-state__hint">
                {search
                  ? '换个关键词试试。'
                  : priorityFilter !== 'all'
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
                  <section
                    key={status}
                    className={`section section--drop ${dragOverStatus === status ? 'section--drop-active' : ''}`}
                    style={{ marginBottom: 0 }}
                    onDragOver={(e) => handleDragOver(e, status)}
                    onDragLeave={(e) => handleDragLeave(e, status)}
                    onDrop={(e) => handleDrop(e, status)}
                  >
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
                        {items.length === 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              fontWeight: 400,
                              fontStyle: 'italic',
                            }}
                          >
                            (空 · 可拖入)
                          </span>
                        )}
                        {overdueInSection > 0 && (
                          <span
                            className="badge badge--danger"
                            style={{ fontSize: 10, padding: '1px 6px' }}
                          >
                            {overdueInSection} 过期
                          </span>
                        )}
                        {dragOverStatus === status && (
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: 11,
                              color: meta.color,
                              fontWeight: 600,
                            }}
                          >
                            松开改状态
                          </span>
                        )}
                      </h2>
                    </button>

                    {!isCollapsed && (
                      <div style={{ display: 'grid', gap: 6, minHeight: 8 }}>
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
                            onDelete={() => {
                              if (confirm(`确定要删除「${a.title}」吗？`)) {
                                deleteMutation.mutate(a.id);
                              }
                            }}
                            isUpdating={
                              updateMutation.isPending &&
                              updateMutation.variables?.id === a.id
                            }
                            isDragging={draggingId === a.id}
                            onDragStart={(e) => handleDragStart(e, a.id)}
                            onDragEnd={handleDragEnd}
                          />
                        ))}
                        {items.length === 0 && (
                          <div
                            style={{
                              padding: '12px 8px',
                              fontSize: 12,
                              color: 'var(--muted)',
                              textAlign: 'center',
                              border: '1px dashed var(--border)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            拖到这里改状态
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
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
  onToggleDone,
  onDelete,
  isUpdating,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  action: Action;
  contact: { id: string; nickname: string; name: string | null } | null;
  onToggleDone: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}) {
  const isDone = action.status === 'done';
  const displayName = contact ? (contact.nickname ?? contact.name ?? '?') : '';
  const [hovered, setHovered] = useState(false);

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

  const category = action.category
    ? categoryMeta(action.category, ACTION_PRESETS)
    : null;

  const pri = priorityMeta(action.priority);

  return (
    <div
      className={`kanban__card row-card ${dueTone ? `row-card--${dueTone}` : ''} ${isDragging ? 'kanban__card--dragging' : ''}`}
      style={{
        padding: '10px 12px',
        opacity: isDone ? 0.65 : isDragging ? 0.4 : 1,
        cursor: 'grab',
      }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={isDone ? '标记未完成' : '标记完成'}
        disabled={isUpdating}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggleDone();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `1.5px solid ${isDone ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: isDone ? 'var(--accent)' : '#fff',
          cursor: isUpdating ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 11,
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
          gap: 4,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            textDecoration: isDone ? 'line-through' : 'none',
            color: isDone ? 'var(--muted)' : 'var(--fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {action.title}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--muted)',
            flexWrap: 'wrap',
          }}
        >
          {dueLabel && (
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
          )}
          {category && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                color: category.color,
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 10 }}>{category.icon}</span>
              {category.label}
            </span>
          )}
          {displayName && (
            <span style={{ color: 'var(--accent)' }}>{displayName}</span>
          )}
        </div>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span
          title={`优先级: ${pri.label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 8px',
            borderRadius: 999,
            border: `1px solid ${pri.color}40`,
            background: `${pri.color}14`,
            fontSize: 10,
            fontWeight: 600,
            color: pri.color,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: pri.color,
            }}
          />
          {pri.label}
        </span>
        <Link
          to={`/actions/${action.id}/edit`}
          className="btn btn-sm btn-ghost"
          style={{
            padding: '2px 6px',
            fontSize: 12,
            opacity: hovered ? 1 : 0.55,
            transition: `opacity var(--transition)`,
          }}
          title="编辑"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          ✎
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onDelete();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          className="btn btn-sm btn-ghost"
          style={{
            padding: '2px 6px',
            fontSize: 12,
            color: 'var(--danger)',
            opacity: hovered ? 1 : 0,
            transition: `opacity var(--transition)`,
          }}
          title="删除"
        >
          🗑
        </button>
      </div>
    </div>
  );
}