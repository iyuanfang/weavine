import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Reminder } from '../lib/adapter/types';

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

const KIND_DOT: Record<string, string> = {
  action_overdue: '#ef4444',
  event_upcoming: '#3b82f6',
  contact_reminder: '#10b981',
};

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'action_overdue', label: '过期待办' },
  { value: 'event_upcoming', label: '近期日程' },
  { value: 'contact_reminder', label: '互动提醒' },
];

export function Reminders() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();
  const queryClient = useQueryClient();

  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');

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

  const dismissMutation = useMutation({
    mutationFn: (reminderId: string) => adapter.reminders.dismiss(reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', ownerId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (reminderId: string) => adapter.reminders.delete(reminderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reminders', ownerId] });
    },
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (remindersQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载提醒失败: {String(remindersQuery.error)}</div>
      </div>
    );
  }

  let allReminders = remindersQuery.data ?? [];
  if (!includeDismissed) {
    allReminders = allReminders.filter((r) => !r.dismissed);
  }
  allReminders = [...allReminders].sort(
    (a, b) => new Date(a.trigger_at).getTime() - new Date(b.trigger_at).getTime(),
  );

  const countsByKind = KIND_FILTERS.reduce<Record<string, number>>((acc, k) => {
    acc[k.value] = k.value === 'all' ? allReminders.length : allReminders.filter((r) => r.kind === k.value).length;
    return acc;
  }, {});

  const visible = kindFilter === 'all' ? allReminders : allReminders.filter((r) => r.kind === kindFilter);

  const isLoading =
    remindersQuery.isLoading || contactsQuery.isLoading || eventsQuery.isLoading;

  return (
    <div className="page">
      <PageHeader
        title="提醒中心"
        subtitle={
          <>
            {visible.length} 个提醒
            {includeDismissed && (
              <span style={{ marginLeft: 6, color: 'var(--muted)' }}>· 含已忽略</span>
            )}
          </>
        }
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIncludeDismissed(!includeDismissed)}
          >
            {includeDismissed ? '隐藏已忽略' : '查看全部'}
          </button>
        }
      />

      <div className="layout-split">
        <aside className="filter-panel">
          <div className="filter-panel__section">
            <div className="filter-panel__title">类型</div>
            {KIND_FILTERS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKindFilter(k.value)}
                className={`filter-panel__item ${
                  kindFilter === k.value ? 'filter-panel__item--active' : ''
                }`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    className="filter-panel__item-dot"
                    style={{ background: k.value === 'all' ? '#6b7280' : KIND_DOT[k.value] }}
                  />
                  <span>{k.label}</span>
                </span>
                <span className="filter-panel__count">{countsByKind[k.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="layout-split__main">
          {isLoading ? (
            <div className="loading">加载中</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">
                {includeDismissed ? '所有提醒都已忽略' : '没有待处理的提醒 🎉'}
              </h3>
              <p className="empty-state__hint">
                {includeDismissed
                  ? '把已忽略的也清掉吧。'
                  : '所有重要的事情都已经处理完了。'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {visible.map((r) => (
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
      </div>
    </div>
  );
}

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
      className="row-card"
      style={{ opacity: reminder.dismissed ? 0.6 : 1 }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{kindIcon}</span>
      <span className="row-card__meta">{triggerTime}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-card__title">
          {kindLabel}
          {displayName && (
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>
              · {displayName}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {event && (
          <Link
            to={`/events/${event.id}`}
            className="badge badge--muted"
            style={{ textDecoration: 'none' }}
          >
            日程
          </Link>
        )}
        {contact && (
          <Link
            to={`/contacts/${contact.id}`}
            className="badge badge--muted"
            style={{ textDecoration: 'none' }}
          >
            联系人
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {!reminder.dismissed && (
          <button
            type="button"
            onClick={() => onDismiss(reminder.id)}
            disabled={isDismissing}
            className="btn btn-sm btn-secondary"
            style={{ opacity: isDismissing ? 0.6 : 1 }}
          >
            {isDismissing ? '…' : '忽略'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(reminder.id)}
          disabled={isDeleting}
          className="btn btn-sm btn-danger"
          style={{ opacity: isDeleting ? 0.6 : 1 }}
        >
          {isDeleting ? '…' : '删除'}
        </button>
      </div>
    </div>
  );
}