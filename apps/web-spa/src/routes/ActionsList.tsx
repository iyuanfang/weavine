import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ContactBadge } from '../components/ContactBadge';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import { PageHeader } from '../components/PageHeader';
import { ProjectBadge } from '../components/ProjectBadge';
import { statusMeta } from '../components/StatusPicker';
import { priorityMeta } from '../components/PriorityPicker';
import { categoryMeta, ACTION_PRESETS } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useUserId } from '../lib/auth';
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
  const userId = useUserId();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useLocalStorageSet('prm:actions:collapsed');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const actionId = String(active.id);
    const targetStatus = String(over.id) as StatusKey;
    if (!STATUS_ORDER.includes(targetStatus)) return;
    const action = allActions.find((a) => a.id === actionId);
    if (!action || action.status === targetStatus) return;
    updateMutation.mutate({
      id: actionId,
      status: targetStatus,
      completed_at: targetStatus === 'done' ? new Date().toISOString() : null,
    });
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  const activeActionsKey = ['actions', userId, 'active'];

  const actionsQuery = useQuery({
    queryKey: activeActionsKey,
    queryFn: () =>
      adapter.actions.list({
        user_id: userId!,
        archived: 'false',
        limit: 500,
      }),
    enabled: !!userId,
    refetchOnMount: 'always',
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateActionInput) => adapter.actions.update(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: activeActionsKey });
      const prev = queryClient.getQueryData<Action[]>(activeActionsKey);
      if (prev) {
        queryClient.setQueryData<Action[]>(activeActionsKey, (old) =>
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
      if (ctx?.prev) queryClient.setQueryData(activeActionsKey, ctx.prev);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<Action[]>(activeActionsKey, (old) =>
        (old ?? []).map((a) => (a.id === data.id ? data : a)),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adapter.actions.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: activeActionsKey });
      const prev = queryClient.getQueryData<Action[]>(activeActionsKey);
      if (prev) {
        queryClient.setQueryData<Action[]>(activeActionsKey, (old) =>
          (old ?? []).filter((a) => a.id !== id),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(activeActionsKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', userId] });
    },
  });

  const allActions = actionsQuery.data ?? [];
  const activeDragAction = useMemo(
    () => (activeDragId ? allActions.find((a) => a.id === activeDragId) ?? null : null),
    [activeDragId, allActions],
  );

  const archiveCountsQuery = useQuery({
    queryKey: ['archive', 'counts', userId],
    queryFn: () => adapter.archive.counts(userId!),
    enabled: !!userId,
    refetchOnMount: 'always',
  });

  if (!userId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (actionsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载待办失败: {String(actionsQuery.error)}</div>
      </div>
    );
  }

  const visible = allActions
    .filter((a) => priorityFilter === 'all' || a.priority === Number(priorityFilter))
    .filter((a) => {
      if (!debouncedSearch) return true;
      const haystack = [
        a.title,
        a.description ?? '',
        a.category ?? '',
        a.contact_nickname ?? '',
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
            <span style={{ fontSize: 'var(--text-base)' }}>●</span>
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
            fontSize: 'var(--text-base)',
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
                fontSize: 'var(--text-sm)',
                color: 'var(--danger)',
                fontWeight: 500,
              }}
            >
              ⚠ {overdueCount} 个已过期
            </div>
          )}
        </div>
      </div>

      <div className="filter-panel__divider" />

      <div className="filter-panel__section">
        <Link
          to="/archive"
          className="filter-panel__item"
          style={{ opacity: 0.7 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📦</span>
            <span>
              已归档 {archiveCountsQuery.data?.action ?? 0} 项
            </span>
          </span>
          <span aria-hidden>查看 →</span>
        </Link>
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
          <Link to="/actions/new?from=/actions" className="btn btn-primary">
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
              <Link to="/actions/new?from=/actions" className="btn btn-primary">
                + 新建待办
              </Link>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
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
                    <StatusSection
                      key={status}
                      status={status}
                      meta={meta}
                      items={items}
                      isCollapsed={isCollapsed}
                      onToggle={toggle}
                      overdueInSection={overdueInSection}
                      updateMutation={updateMutation}
                      deleteMutation={deleteMutation}
                      activeDragId={activeDragId}
                    />
                  );
                })}
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDragAction ? (
                  <div
                    style={{
                      pointerEvents: 'none',
                      transform: 'rotate(-2deg)',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                      borderRadius: 8,
                      background: 'var(--surface)',
                      maxWidth: 480,
                    }}
                  >
                    <ActionRowBody
                      action={activeDragAction}
                      onToggleDone={() => {}}
                      onDelete={() => {}}
                      isUpdating={false}
                      isDragging={false}
                      dragHandleProps={undefined}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}

type ActionRowBodyProps = {
  action: Action;
  onToggleDone: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDragging: boolean;
  dragHandleProps?: Record<string, unknown>;
};

function ActionRowBody({
  action,
  onToggleDone,
  onDelete,
  isUpdating,
  isDragging,
  dragHandleProps,
}: ActionRowBodyProps) {
  const isDone = action.status === 'done';
  const contactMini =
    action.contact_id && action.contact_nickname
      ? { id: action.contact_id, nickname: action.contact_nickname, name: null }
      : null;
  const projectMini =
    action.project_id && action.project_title
      ? {
          id: action.project_id,
          title: action.project_title,
          template: 'general',
          stage: 'planning',
          user_id: action.user_id,
        }
      : null;
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
        cursor: dragHandleProps ? 'grab' : 'default',
        touchAction: dragHandleProps ? 'none' : 'auto',
      }}
      {...(dragHandleProps ?? {})}
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
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          opacity: isUpdating ? 0.6 : 1,
          transition: `all var(--transition)`,
        }}
      >
        {isDone && '✓'}
      </button>

      <Link
        to={`/actions/${action.id}?from=/actions`}
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
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            textDecoration: isDone ? 'line-through' : 'none',
            color: isDone ? 'var(--muted)' : 'var(--fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
          }}
        >
          {action.title}
        </div>
        <div
          className="cluster"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--muted)',
            lineHeight: 1.4,
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
              <span style={{ fontSize: 'var(--text-xs)' }}>{category.icon}</span>
              {category.label}
            </span>
          )}
          {contactMini && <ContactBadge contact={contactMini} />}
          {action.project_id && <ProjectBadge project={projectMini} />}
        </div>
      </Link>

      <div className="cluster cluster--row" style={{ flexShrink: 0 }}>
        <span
          title={`优先级: ${pri.label}`}
          className="pill pill--colored"
          style={{
            '--pill-bg': `${pri.color}14`,
            '--pill-border': `${pri.color}40`,
            '--pill-fg': pri.color,
          } as React.CSSProperties}
        >
          <span className="dot dot--xs" style={{ background: pri.color }} />
          {pri.label}
        </span>
        <Link
          to={`/actions/${action.id}/edit?from=/actions`}
          className="btn btn-sm btn-ghost"
          style={{
            padding: '2px 6px',
            fontSize: 'var(--text-sm)',
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
            fontSize: 'var(--text-sm)',
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

function DraggableActionRow({
  action,
  onToggleDone,
  onDelete,
  isUpdating,
}: {
  action: Action;
  onToggleDone: () => void;
  onDelete: () => void;
  isUpdating: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: action.id,
    data: { type: 'action', status: action.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      aria-roledescription="draggable"
    >
      <ActionRowBody
        action={action}
        onToggleDone={onToggleDone}
        onDelete={onDelete}
        isUpdating={isUpdating}
        isDragging={isDragging}
        dragHandleProps={{ ...listeners, ...attributes }}
      />
    </div>
  );
}

type StatusSectionProps = {
  status: StatusKey;
  meta: ReturnType<typeof statusMeta>;
  items: Action[];
  isCollapsed: boolean;
  onToggle: () => void;
  overdueInSection: number;
  updateMutation: ReturnType<typeof useMutation<unknown, Error, UpdateActionInput, { prev: Action[] | undefined }>>;
  deleteMutation: ReturnType<typeof useMutation<unknown, Error, string, { prev: Action[] | undefined }>>;
  activeDragId: string | null;
};

function StatusSection({
  status,
  meta,
  items,
  isCollapsed,
  onToggle,
  overdueInSection,
  updateMutation,
  deleteMutation,
  activeDragId,
}: StatusSectionProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const dropActive = isOver || activeDragId !== null;

  return (
    <section
      ref={setNodeRef}
      className={`section section--drop ${dropActive ? 'section--drop-active' : ''}`}
      style={{ marginBottom: 0 }}
      data-status={status}
    >
      <button
        type="button"
        onClick={onToggle}
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
              fontSize: 'var(--text-xs)',
              opacity: 0.6,
            }}
          >
            ▼
          </span>
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          <span className="badge badge--muted" style={{ fontWeight: 500, marginLeft: 4 }}>
            {items.length}
          </span>
          {items.length === 0 && (
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--muted)',
                fontWeight: 400,
                fontStyle: 'italic',
              }}
            >
              (空 · 可拖入)
            </span>
          )}
          {overdueInSection > 0 && (
            <span className="badge badge--danger" style={{ fontSize: 'var(--text-xs)', padding: '1px 6px' }}>
              {overdueInSection} 过期
            </span>
          )}
          {dropActive && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--text-xs)',
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
            <DraggableActionRow
              key={a.id}
              action={a}
              onToggleDone={() =>
                updateMutation.mutate({
                  id: a.id,
                  status: a.status === 'done' ? 'open' : 'done',
                  completed_at: a.status === 'done' ? null : new Date().toISOString(),
                })
              }
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
          {items.length === 0 && (
            <div
              style={{
                padding: '12px 8px',
                fontSize: 'var(--text-sm)',
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
}