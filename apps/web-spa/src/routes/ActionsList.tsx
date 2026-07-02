import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Action, UpdateActionInput } from '../lib/adapter/types';

// ── Constants ───────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'inbox', label: '收件箱' },
  { value: 'open', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  inbox: '📥 收件箱',
  open: '🔨 进行中',
  waiting: '⏳ 等待中',
  done: '✅ 已完成',
  cancelled: '🗑 已取消',
  dropped: '🗑 已放弃',
};

const PRIORITY_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: '3', label: '高' },
  { value: '2', label: '中' },
  { value: '1', label: '低' },
] as const;

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

export function ActionsList() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  // ── Filters ───────────────────────────────────────

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // ── Fetch actions ─────────────────────────────────

  const actionsQuery = useQuery({
    queryKey: ['actions', ownerId],
    queryFn: () =>
      adapter.actions.list({
        owner_id: ownerId!,
        limit: 500,
      }),
    enabled: !!ownerId,
  });

  // ── Contacts query (for links) ────────────────────

  const contactsQuery = useQuery({
    queryKey: ['contacts', ownerId],
    queryFn: () => adapter.contacts.list({ owner_id: ownerId! }),
    enabled: !!ownerId,
  });

  const contactMap = (contactsQuery.data ?? []).reduce<Record<string, { id: string; nickname: string; name: string | null }>>(
    (acc, c) => {
      acc[c.id] = { id: c.id, nickname: c.nickname, name: c.name };
      return acc;
    },
    {},
  );

  // ── One-click complete mutation ───────────────────

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

  // ── Guards ────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (actionsQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载待办失败: {String(actionsQuery.error)}</div>
      </div>
    );
  }

  // ── Filter + sort ─────────────────────────────────

  const allActions = actionsQuery.data ?? [];
  let filtered = allActions;

  if (statusFilter !== 'all') {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }

  if (priorityFilter !== 'all') {
    filtered = filtered.filter((a) => a.priority === Number(priorityFilter));
  }

  // Sort: priority desc, then due_at asc
  filtered = [...filtered].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.due_at && b.due_at) {
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    }
    if (a.due_at) return -1;
    if (b.due_at) return 1;
    return 0;
  });

  // ── Render ────────────────────────────────────────

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(today.getTime() + 86400000);

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <h1 className="section__title">待办</h1>
        <Link
          to="/actions/new"
          style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}
        >
          + 新建
        </Link>
      </div>

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {STATUS_OPTIONS.map((opt) => {
          const active = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-soft)' : '#fff',
                color: active ? 'var(--accent)' : 'var(--fg)',
                transition: 'all 0.1s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Priority filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRIORITY_OPTIONS.map((opt) => {
          const active = priorityFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setPriorityFilter(opt.value)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-soft)' : '#fff',
                color: active ? 'var(--accent)' : 'var(--fg)',
                transition: 'all 0.1s',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Count */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        共 {filtered.length} 个
      </div>

      {/* Loading / empty */}
      {actionsQuery.isLoading ? (
        <div className="loading">…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {(statusFilter !== 'all' || priorityFilter !== 'all') ? (
            <p>没有匹配的待办</p>
          ) : (
            <p>还没有待办。从一件具体的小事开始：</p>
          )}
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
  );
}

// ── Action Row ──────────────────────────────────────

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
  const [isHovered, setIsHovered] = useState(false);

  // Due date classification
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
  const prioColor = PRIORITY_BADGE_COLORS[String(action.priority)] ?? '#d1d5db';

  const displayName = contact ? (contact.nickname ?? contact.name ?? '?') : '';

  return (
    <div
      className={`row-card ${dueTone ? `row-card--${dueTone}` : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={() => {
        // Navigate to detail unless clicking the checkbox
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Checkbox — one-click complete */}
      <button
        type="button"
        aria-label="标记完成"
        disabled={action.status === 'done' || isCompleting}
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: `1px solid ${action.status === 'done' ? 'var(--accent)' : 'var(--border)'}`,
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
        }}
        onClick={(e) => {
          e.stopPropagation();
          onComplete(action.id);
        }}
      >
        {action.status === 'done' && '✓'}
      </button>

      {/* Title + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {statusLabel}
          {dueLabel && <span style={{ margin: '0 4px' }}>·</span>}
          {dueLabel}
          {displayName && <span style={{ margin: '0 4px' }}>·</span>}
          {displayName && (
            <span style={{ color: 'var(--accent)', cursor: 'pointer' }}>
              {displayName}
            </span>
          )}
        </div>
      </div>

      {/* Priority badge */}
      {prioLabel && (
        <span
          style={{
            fontSize: 11,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${prioColor}18`,
            color: prioColor,
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          P{action.priority}
        </span>
      )}

      {/* View link */}
      {isHovered && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--accent)',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          →
        </span>
      )}
    </div>
  );
}