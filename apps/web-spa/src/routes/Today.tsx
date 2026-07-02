import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Action, Event, Interaction } from '../lib/adapter/types';

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

function formatDate(d: Date): string {
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function TodayPage() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  // Fetch the three feeds in parallel. We over-fetch slightly
  // (200 actions, 10 events, 20 interactions) and then filter
  // down to the "today" window client-side, because the Rust
  // list commands don't expose a due_at range filter.
  const actionsQuery = useQuery({
    queryKey: ['actions', ownerId, 'all-for-today'],
    queryFn: () =>
      adapter.actions.list({
        owner_id: ownerId!,
        limit: 200,
      }),
    enabled: Boolean(ownerId),
  });

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'upcoming-for-today'],
    queryFn: () => adapter.events.upcoming(ownerId!, 10),
    enabled: Boolean(ownerId),
  });

  const interactionsQuery = useQuery({
    queryKey: ['interactions', ownerId, 'recent-for-today'],
    queryFn: () =>
      adapter.interactions.list({
        owner_id: ownerId!,
        limit: 20,
      }),
    enabled: Boolean(ownerId),
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (
    actionsQuery.isError ||
    eventsQuery.isError ||
    interactionsQuery.isError
  ) {
    const err =
      actionsQuery.error ?? eventsQuery.error ?? interactionsQuery.error;
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

  return (
    <div className="today-page">
      <h1>今天</h1>

      <section className="section">
        <SectionHeader title="🎯 今日要做" viewAllHref="/actions" />
        {isLoading ? (
          <Skeleton />
        ) : todayDoActions.length > 0 ? (
          todayDoActions.map((a) => <ActionCard key={a.id} action={a} now={now} />)
        ) : (
          <div className="empty-state">🎉 今天没有到期的事</div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="近期日程" viewAllHref="/calendar" />
        {isLoading ? (
          <Skeleton />
        ) : upcomingEvents.length > 0 ? (
          upcomingEvents.map((e) => (
            <EventCard key={e.id} event={e} baseDay={baseDay} />
          ))
        ) : (
          <div className="empty-state">最近没有日程</div>
        )}
      </section>

      <section className="section">
        <SectionHeader title="📝 近期互动" viewAllHref="/contacts" />
        {isLoading ? (
          <Skeleton />
        ) : recentInteractions.length > 0 ? (
          recentInteractions.map((i) => (
            <InteractionRow key={i.id} interaction={i} />
          ))
        ) : (
          <div className="empty-state">最近 7 天没有互动</div>
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

function Skeleton() {
  return <div className="loading">…</div>;
}

function ActionCard({ action, now }: { action: Action; now: Date }) {
  const dueAt = new Date(action.due_at!);
  const isOverdue = dueAt < now;
  const tone = isOverdue ? 'overdue' : 'today';
  const subtitle = `${isOverdue ? '已过期 · ' : '今天 '}${formatDate(dueAt)} ${formatTime(dueAt)}`;
  return (
    <div className={`row-card row-card--${tone}`}>
      <span className="row-card__title">{action.title}</span>
      <span className="row-card__meta">{subtitle}</span>
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
  const dayLabel = formatDayLabel(startAt, baseDay);
  const subtitle = `${dayLabel} ${formatTime(startAt)}${event.location ? ` · ${event.location}` : ''}`;
  return (
    <div className="row-card">
      <span className="row-card__title">{event.title}</span>
      <span className="row-card__meta">{subtitle}</span>
    </div>
  );
}

function InteractionRow({ interaction }: { interaction: Interaction }) {
  const d = new Date(interaction.occurred_at);
  return (
    <div className="row-card">
      <span className="row-card__meta">
        {d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
      </span>
      <span className="row-card__title">{interaction.summary}</span>
      {interaction.channel && (
        <span className="row-card__meta">{interaction.channel}</span>
      )}
    </div>
  );
}
