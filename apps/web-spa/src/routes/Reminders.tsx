import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Reminder } from '../lib/adapter/types';

// ── Helpers ──────────────────────────────────────────

function formatReminderTime(d: Date): string {
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const KIND_LABELS: Record<string, string> = {
  action_overdue: '过期待办',
  event_upcoming: '近期日程',
  contact_reminder: '互动提醒',
};

const KIND_ICONS: Record<string, string> = {
  action_overdue: '⚠️',
  event_upcoming: '📅',
  contact_reminder: '👤',
};

// ── Page ────────────────────────────────────────────

export function Reminders() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [includeDismissed, setIncludeDismissed] = useState(false);

  // ── Fetch reminders ───────────────────────────────

  const remindersQuery = useQuery({
    queryKey: ['reminders', ownerId, { include_dismissed: includeDismissed }],
    queryFn: () =>
      adapter.reminders.list({
        owner_id: ownerId!,
        include_dismissed: includeDismissed || null,
        limit: 200,
      }),
    enabled: !!ownerId,
  });

  // ── Fetch contacts (for links) ────────────────────

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

  // ── Fetch events (for links) ──────────────────────

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'all'],
    queryFn: () =>
      adapter.events.list({
        owner_id: ownerId!,
        limit: 200,
      }),
    enabled: !!ownerId,
  });

  const eventMap = (eventsQuery.data ?? []).reduce<Record<string, { id: string; title: string }>>(
    (acc, e) => {
      acc[e.id] = { id: e.id, title: e.title };
      return acc;
    },
    {},
  );

  // ── Dismiss mutation ──────────────────────────────

  const dismissMutation = useMutation({
    mutationFn: (reminderId: string) => adapter.reminders.dismiss(reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', ownerId] });
    },
  });

  // ── Delete mutation ───────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: (reminderId: string) => adapter.reminders.delete(reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', ownerId] });
    },
  });

  // ── Guards ────────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (remindersQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载提醒失败: {String(remindersQuery.error)}</div>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────

  let allReminders = remindersQuery.data ?? [];

  // Filter out dismissed when tab is "隐藏已忽略"
  if (!includeDismissed) {
    allReminders = allReminders.filter((r) => !r.dismissed);
  }

  // Sort by trigger_at ascending
  allReminders = [...allReminders].sort((a, b) =>
    new Date(a.trigger_at).getTime() - new Date(b.trigger_at).getTime(),
  );

  const isLoading = remindersQuery.isLoading || contactsQuery.isLoading || eventsQuery.isLoading;

  // ── Render ────────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header */}
      <div className="section__header">
        <h1 className="section__title">提醒中心</h1>
      </div>

      {/* Toggle for dismissed */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          onClick={() => setIncludeDismissed(false)}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            cursor: 'pointer',
            border: `1px solid ${!includeDismissed ? 'var(--accent)' : 'var(--border)'}`,
            background: !includeDismissed ? 'var(--accent-soft)' : '#fff',
            color: !includeDismissed ? 'var(--accent)' : 'var(--fg)',
            transition: 'all 0.1s',
          }}
        >
          未忽略
        </button>
        <button
          onClick={() => setIncludeDismissed(true)}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            cursor: 'pointer',
            border: `1px solid ${includeDismissed ? 'var(--accent)' : 'var(--border)'}`,
            background: includeDismissed ? 'var(--accent-soft)' : '#fff',
            color: includeDismissed ? 'var(--accent)' : 'var(--fg)',
            transition: 'all 0.1s',
          }}
        >
          包含已忽略
        </button>
      </div>

      {/* Count */}
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        共 {allReminders.length} 个提醒
      </div>

      {/* Loading / empty */}
      {isLoading ? (
        <div className="loading">…</div>
      ) : allReminders.length === 0 ? (
        <div className="empty-state">
          {includeDismissed ? (
            <p>所有提醒都已忽略</p>
          ) : (
            <p>没有待处理的提醒 🎉</p>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {allReminders.map((r) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              contact={r.contact_id ? contactMap[r.contact_id] : null}
              event={r.event_id ? eventMap[r.event_id] : null}
              onDismiss={dismissMutation.mutate}
              onDelete={deleteMutation.mutate}
              isDismissing={dismissMutation.variables === r.id}
              isDeleting={deleteMutation.variables === r.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reminder Row ────────────────────────────────────

function ReminderRow({
  reminder,
  contact,
  event,
  onDismiss,
  onDelete,
  isDismissing,
  isDeleting,
}: {
  reminder: Reminder;
  contact: { id: string; nickname: string; name: string | null } | null;
  event: { id: string; title: string } | null;
  onDismiss: (id: string) => void;
  onDelete: (id: string) => void;
  isDismissing: boolean;
  isDeleting: boolean;
}) {
  const triggerTime = formatReminderTime(new Date(reminder.trigger_at));
  const kindLabel = KIND_LABELS[reminder.kind] ?? reminder.kind;
  const kindIcon = KIND_ICONS[reminder.kind] ?? '';

  const contactLabel = contact ? (contact.nickname ?? contact.name ?? '?') : '';

  const displayName = event?.title ?? contactLabel;

  return (
    <div
      className={`row-card ${reminder.dismissed ? 'row-card--dismissed' : ''}`}
      style={{ opacity: reminder.dismissed ? 0.6 : 1 }}
    >
      {/* Time */}
      <span className="row-card__meta">{triggerTime}</span>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="row-card__title">
          {kindIcon} {kindLabel}
          {displayName && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>
              · {displayName}
            </span>
          )}
        </span>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {event && (
          <Link
            to={`/events/${event.id}`}
            className="row-card__meta"
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
          >
            日程
          </Link>
        )}
        {contact && (
          <Link
            to={`/contacts/${contact.id}`}
            className="row-card__meta"
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}
          >
            联系人
          </Link>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        {!reminder.dismissed && (
          <button
            onClick={() => onDismiss(reminder.id)}
            disabled={isDismissing}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: '#fff',
              fontSize: 12,
              cursor: isDismissing ? 'not-allowed' : 'pointer',
              opacity: isDismissing ? 0.6 : 1,
            }}
          >
            忽略
          </button>
        )}
        <button
          onClick={() => onDelete(reminder.id)}
          disabled={isDeleting}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background: '#ef4444',
            color: '#fff',
            fontSize: 12,
            cursor: isDeleting ? 'not-allowed' : 'pointer',
            opacity: isDeleting ? 0.6 : 1,
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}