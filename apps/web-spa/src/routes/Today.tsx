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

  const overdueCount = todayDoActions.filter((a) => new Date(a.due_at!) < now).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">今天</h1>
          <p className="page-subtitle">
            {now.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </p>
        </div>
      </div>

      <div
        className="kpi-row"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div className="card card--accent" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
            待办
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {todayDoActions.length}
          </div>
          {overdueCount > 0 && (
            <div className="text-xs" style={{ color: 'var(--danger)', marginTop: 2 }}>
              {overdueCount} 已过期
            </div>
          )}
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
            日程
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {upcomingEvents.length}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            接下来 3 天
          </div>
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="text-xs text-muted" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
            互动
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {recentInteractions.length}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>
            最近 7 天
          </div>
        </div>
      </div>

      <section className="section">
        <SectionHeader title="🎯 今日要做" viewAllHref="/actions" />
        {isLoading ? (
          <Skeleton />
        ) : todayDoActions.length > 0 ? (
          todayDoActions.map((a) => <ActionCard key={a.id} action={a} now={now} />)
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
          <Skeleton />
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

      <section className="section">
        <SectionHeader title="📝 近期互动" viewAllHref="/contacts" />
        {isLoading ? (
          <Skeleton />
        ) : recentInteractions.length > 0 ? (
          recentInteractions.map((i) => (
            <InteractionRow key={i.id} interaction={i} />
          ))
        ) : (
          <div className="empty-state">
            <h3 className="empty-state__title">最近 7 天没有互动</h3>
            <p className="empty-state__hint">找个人打个招呼，记录一条互动</p>
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

function Skeleton() {
  return <div className="loading">加载中</div>;
}

function ActionCard({ action, now }: { action: Action; now: Date }) {
  const dueAt = new Date(action.due_at!);
  const isOverdue = dueAt < now;
  const tone = isOverdue ? 'overdue' : 'today';
  const subtitle = `${isOverdue ? '已过期 · ' : '今天 '}${formatDate(dueAt)} ${formatTime(dueAt)}`;
  return (
    <div className={`row-card row-card--${tone}`}>
      <span style={{ fontSize: 18 }}>{isOverdue ? '⏰' : '📌'}</span>
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
      <span style={{ fontSize: 18 }}>📅</span>
      <span className="row-card__title">{event.title}</span>
      <span className="row-card__meta">{subtitle}</span>
    </div>
  );
}

function InteractionRow({ interaction }: { interaction: Interaction }) {
  const d = new Date(interaction.occurred_at);
  return (
    <div className="row-card">
      <span style={{ fontSize: 18 }}>💬</span>
      <span className="row-card__meta">
        {d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
      </span>
      <span className="row-card__title">{interaction.summary}</span>
      {interaction.channel && (
        <span className="badge badge--muted">{interaction.channel}</span>
      )}
    </div>
  );
}
