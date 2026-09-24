import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ContactBadge } from '../components/ContactBadge';
import { HomeGraph } from '../components/HomeGraph';
import { InteractionSourceTag } from '../components/InteractionSourceTag';
import { ReminderCountdown } from '../components/ReminderCountdown';
import { useAdapter } from '../lib/adapter';
import { useQuickCapture } from '../App';
import { useUserId } from '../lib/auth';
import { seedDemoDataIfEmpty } from '../lib/seed-demo';
import { nextReminderIn } from '../lib/keepInTouch';
import type { Action, Event, Interaction, UpdateActionInput } from '../lib/adapter/types';

// Window helpers — local time, no UTC confusion.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayLabel(startAt: Date, baseDay: Date): string {
  const dayDiff = Math.round(
    (startOfDay(startAt).getTime() - baseDay.getTime()) / 86400000,
  );
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '明天';
  if (dayDiff === 2) return '后天';
  return startAt.toLocaleString('zh-CN', { weekday: 'short' });
}

function formatTime(d: Date): string {
  return d.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function daysSinceLabel(iso: string | null | undefined): string {
  if (!iso) return '从未';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return `${Math.round(days / 30)} 个月前`;
}

function formatDate(d: Date): string {
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function relativeDueLabel(dueAt: Date, now: Date): string {
  const ms = dueAt.getTime() - now.getTime();
  const hours = Math.round(ms / 3_600_000);
  const dayDiff = Math.round(ms / 86_400_000);
  if (ms < 0) {
    if (hours < -23) return `已过期 ${Math.abs(dayDiff)} 天`;
    return `已过期 ${Math.abs(hours)} 小时`;
  }
  if (dayDiff === 0) return hours <= 1 ? '1 小时内' : `${hours} 小时后`;
  if (dayDiff === 1) return `明天 ${formatTime(dueAt)}`;
  if (dayDiff === 2) return `后天 ${formatTime(dueAt)}`;
  return formatDate(dueAt);
}

export function TodayPage() {
  const adapter = useAdapter();
  const userId = useUserId();
  const queryClient = useQueryClient();
  const quickCapture = useQuickCapture();
  const seedRanRef = useRef(false);

  // First-run demo data. Runs before the feeds below; if it seeds anything
  // the queries are invalidated so the graph/stream show it immediately.
  useEffect(() => {
    if (!userId || seedRanRef.current) return;
    seedRanRef.current = true;
    seedDemoDataIfEmpty(adapter, userId)
      .then((seeded) => {
        if (seeded) queryClient.invalidateQueries();
      })
      .catch(() => {});
  }, [adapter, userId, queryClient]);

  const actionsQuery = useQuery({
    queryKey: ['actions', userId, 'all-for-today'],
    queryFn: () =>
      adapter.actions.list({
        user_id: userId!,
        archived: 'false',
        limit: 200,
      }),
    enabled: Boolean(userId),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', userId, 'upcoming-for-today'],
    queryFn: () => adapter.events.upcoming(userId!, 10),
    enabled: Boolean(userId),
  });

  const interactionsQuery = useQuery({
    queryKey: ['interactions', userId, 'recent-for-today'],
    queryFn: () =>
      adapter.interactions.list({
        user_id: userId!,
        limit: 20,
      }),
    enabled: Boolean(userId),
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', userId, 'active-for-today'],
    queryFn: () =>
      adapter.projects.list({
        user_id: userId!,
        archived: 'false',
        limit: 200,
      }),
    enabled: Boolean(userId),
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId, 'for-suggestions'],
    queryFn: () =>
      adapter.contacts.list({
        user_id: userId!,
        sort_by: 'last_interaction_at',
        limit: 200,
      }),
    enabled: Boolean(userId),
  });

  const toggleDoneMutation = useMutation({
    mutationFn: (input: { id: string; status: 'done' | 'open' }) =>
      adapter.actions.update({
        id: input.id,
        status: input.status,
      } as UpdateActionInput),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions', userId] });
    },
  });

  if (!userId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (
    actionsQuery.isError ||
    eventsQuery.isError ||
    interactionsQuery.isError ||
    contactsQuery.isError
  ) {
    const err =
      actionsQuery.error ??
      eventsQuery.error ??
      interactionsQuery.error ??
      contactsQuery.error;
    return (
      <div className="today-page">
        <div className="error">加载失败: {String(err)}</div>
      </div>
    );
  }

  const now = new Date();
  const baseDay = startOfDay(now);
  const endOfDayPlus2 = baseDay.getTime() + 3 * 86400000;
  const sevenDaysAgo = baseDay.getTime() - 7 * 86400000;

  const todayDoActions = (actionsQuery.data ?? [])
    .filter((a) => a.status === 'inbox' || a.status === 'open')
    .filter((a) => a.due_at != null)
    .filter((a) => {
      const t = new Date(a.due_at!).getTime();
      return t < endOfDayPlus2;
    })
    .sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pb !== pa) return pb - pa;
      return new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
    })
    .slice(0, 5);

  const upcomingEvents = (eventsQuery.data ?? []).filter((e) => {
    const t = new Date(e.start_at).getTime();
    return t < endOfDayPlus2;
  });

  const recentInteractions = (interactionsQuery.data ?? [])
    .filter((i) => new Date(i.occurred_at).getTime() >= sevenDaysAgo)
    .slice(0, 10);

  const isLoading =
    actionsQuery.isLoading ||
    eventsQuery.isLoading ||
    interactionsQuery.isLoading;

  const contacts = contactsQuery.data?.items ?? [];

  // Contacts to reach out to: already overdue (any amount) or due within 7 days,
  // sorted by most overdue first. Top 5.
  const suggestedContacts = contacts
    .map((c) => ({ c, r: nextReminderIn(c.last_interaction_at, c.importance, c.keep_in_touch_cadence_days, now) }))
    .filter(({ r }) => r.hasCadence && r.days !== null && r.days <= 7)
    .sort((a, b) => (a.r.days ?? 0) - (b.r.days ?? 0))
    .slice(0, 5)
    .map(({ c, r }) => ({ c, days: r.days! }));

  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1 className="page-title">织遇</h1>
          <p className="page-subtitle">
            {now.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
            · 编织你遇见的每一个人
          </p>
        </div>
      </div>

      {/* Capture bar — the primary action of the whole product. */}
      <button
        type="button"
        onClick={() => quickCapture.open()}
        className="card"
        data-testid="home-capture-bar"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 18px',
          marginBottom: 20,
          cursor: 'text',
          textAlign: 'left',
          color: 'var(--muted)',
        }}
      >
        <span style={{ fontSize: 'var(--text-lg)' }}>🎤</span>
        <span style={{ flex: 1, fontSize: 'var(--text-base)' }}>
          今天见了谁？说一句话，或点这里打字…
        </span>
        <span
          className="text-xs text-muted"
          style={{ flexShrink: 0, border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' }}
        >
          \
        </span>
      </button>

      {/* Me-centered relationship graph — the product's soul, front and center. */}
      {contactsQuery.isLoading ? (
        <div className="loading">加载中</div>
      ) : (
        <div style={{ marginBottom: 28 }}>
          <HomeGraph
            contacts={contacts}
            events={eventsQuery.data ?? []}
            actions={actionsQuery.data ?? []}
            projects={projectsQuery.data ?? []}
          />
        </div>
      )}

      <section className="section">
        <SectionHeader title="📞 该联系的人" viewAllHref="/contacts" />
        {contactsQuery.isLoading ? (
          <div className="loading">加载中</div>
        ) : suggestedContacts.length === 0 ? (
          <div className="empty-state">近期没人该联系，享受吧 ☕</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {suggestedContacts.map(({ c }) => (
              <Link
                key={c.id}
                to={`/contacts/${c.id}?from=/today`}
                className="digest-row"
              >
                <span style={{ fontSize: 'var(--text-lg)' }}>📞</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="digest-row__title">{c.nickname}</span>
                  <span className="digest-row__meta" style={{ marginLeft: 8 }}>
                    上次 {daysSinceLabel(c.last_interaction_at)}
                  </span>
                </span>
                <ReminderCountdown
                  importance={c.importance}
                  lastInteractionIso={c.last_interaction_at}
                  overrideDays={c.keep_in_touch_cadence_days}
                />
                <span className="text-muted">→</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="💬 最近遇见" viewAllHref="/contacts" />
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : recentInteractions.length > 0 ? (
          recentInteractions.map((i) => (
            <InteractionRow key={i.id} interaction={i} />
          ))
        ) : (
          <div className="empty-state">
            <h3 className="empty-state__title">最近 7 天没有遇见</h3>
            <p className="empty-state__hint">点上面的输入条，说一句「今天和张三喝了咖啡」试试</p>
          </div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="🎯 今日待办" viewAllHref="/actions" />
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : todayDoActions.length > 0 ? (
          todayDoActions.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              now={now}
              onToggleDone={(status) =>
                toggleDoneMutation.mutate({ id: a.id, status })
              }
            />
          ))
        ) : (
          <div className="empty-state">
            <h3 className="empty-state__title">🎉 今天没有到期的事</h3>
            <p className="empty-state__hint">享受一段没有 deadline 的时光</p>
          </div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="近期日程" viewAllHref="/calendar" />
        {isLoading ? (
          <div className="loading">加载中</div>
        ) : upcomingEvents.length > 0 ? (
          upcomingEvents.map((e) => (
            <EventCard key={e.id} event={e} baseDay={baseDay} />
          ))
        ) : (
          <div className="empty-state">
            <h3 className="empty-state__title">最近没有日程</h3>
            <p className="empty-state__hint">去日程页加一个吧</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  viewAllHref,
}: {
  title: string;
  viewAllHref: string;
}) {
  return (
    <div className="section__header">
      <h2 className="section__title">{title}</h2>
      <Link to={viewAllHref} className="section__view-all">
        全部 →
      </Link>
    </div>
  );
}

function ActionCard({
  action,
  now,
  onToggleDone,
}: {
  action: Action;
  now: Date;
  onToggleDone: (status: 'done' | 'open') => void;
}) {
  const dueAt = new Date(action.due_at!);
  const isDone = action.status === 'done';
  const isOverdue = !isDone && dueAt < now;
  const tone = isOverdue ? 'overdue' : 'today';

  return (
    <div
      className={`row-card row-card--${tone} row-card--mobile-stacked`}
      style={{ opacity: isDone ? 0.55 : 1 }}
    >
      <button
        type="button"
        aria-label={isDone ? '标记未完成' : '标记完成'}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggleDone(isDone ? 'open' : 'done');
        }}
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `1.5px solid ${isDone ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: isDone ? 'var(--accent)' : '#fff',
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          transition: 'all var(--transition)',
        }}
      >
        {isDone && '✓'}
      </button>

      <Link
        to={`/actions/${action.id}?from=/today`}
        style={{
          flex: 1,
          minWidth: 0,
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span className="row-card__icon" style={{ fontSize: 'var(--text-lg)', flexShrink: 0 }}>
          {isOverdue ? '⏰' : '📌'}
        </span>
        <span
          className="row-card__title"
          style={{
            textDecoration: isDone ? 'line-through' : 'none',
            color: isDone ? 'var(--muted)' : 'var(--fg)',
          }}
        >
          {action.title}
        </span>
        {(action.project_title || action.contact_nickname) && (
          <span
            className="row-card__badges"
            style={{
              display: 'inline-flex',
              gap: 4,
              flexShrink: 1,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {action.contact_nickname && (
              <ContactBadge contact={action.contact_nickname} compact />
            )}
          </span>
        )}
        <span
          className="row-card__meta"
          style={{
            color: isOverdue ? 'var(--danger)' : 'var(--muted)',
            fontWeight: isOverdue ? 500 : 400,
            marginLeft: 'auto',
          }}
        >
          {relativeDueLabel(dueAt, now)}
        </span>
      </Link>
    </div>
  );
}

function EventCard({
  event,
  baseDay,
}: {
  event: Event;
  baseDay: Date;
}) {
  const startAt = new Date(event.start_at);
  return (
    <Link
      to={`/events/${event.id}?from=/today`}
      className="row-card row-card--mobile-stacked"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <span className="row-card__icon" style={{ fontSize: 'var(--text-lg)' }}>📅</span>
      <span className="row-card__title">{event.title}</span>
      {(event.location || event.contact_nickname) && (
        <span
          className="row-card__badges"
          style={{
            display: 'inline-flex',
            gap: 4,
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            alignItems: 'center',
          }}
        >
          {event.contact_nickname && (
            <ContactBadge contact={event.contact_nickname} compact />
          )}
          {event.location && (
            <span
              className="text-xs text-muted"
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              📍 {event.location}
            </span>
          )}
        </span>
      )}
      <span className="row-card__meta" style={{ marginLeft: 'auto' }}>
        {formatDayLabel(startAt, baseDay)} {formatTime(startAt)}
      </span>
    </Link>
  );
}

function InteractionRow({ interaction }: { interaction: Interaction }) {
  const d = new Date(interaction.occurred_at);
  return (
    <Link
      to={`/interactions/${interaction.id}?from=/today`}
      className="row-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <span style={{ fontSize: 'var(--text-lg)' }}>💬</span>
      <span className="row-card__meta">
        {d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
      </span>
      <span className="row-card__title">{interaction.summary}</span>
      <InteractionSourceTag source={interaction.source} />
      {interaction.contact_nickname && (
        <ContactBadge contact={interaction.contact_nickname} compact />
      )}
      {interaction.channel && (
        <span className="badge badge--muted">{interaction.channel}</span>
      )}
    </Link>
  );
}
