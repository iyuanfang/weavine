import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Event } from '../lib/adapter/types';

function getMonthStart(base: Date, monthOffset: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthEnd(base: Date, monthOffset: number): Date {
  const firstOfNext = new Date(
    base.getFullYear(),
    base.getMonth() + monthOffset + 1,
    1,
  );
  firstOfNext.setHours(23, 59, 59, 999);
  return firstOfNext;
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleString('zh-CN', { year: 'numeric', month: 'long' });
}

function formatDayLabel(d: Date): string {
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function groupByDay(events: Event[]): Record<string, Event[]> {
  const groups: Record<string, Event[]> = {};
  for (const e of events) {
    const d = new Date(e.start_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }
  return groups;
}

function isDateInMonth(d: Date, monthStart: Date, monthEnd: Date): boolean {
  const t = d.getTime();
  return t >= monthStart.getTime() && t <= monthEnd.getTime();
}

export function Calendar() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const [monthOffset, setMonthOffset] = useState(0);

  const { monthStart, monthEnd } = useMemo(() => {
    const now = new Date();
    return {
      monthStart: getMonthStart(now, monthOffset),
      monthEnd: getMonthEnd(now, monthOffset),
    };
  }, [monthOffset]);

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'by-month', monthOffset],
    queryFn: () =>
      adapter.events.list({
        owner_id: ownerId!,
        start_after: monthStart.toISOString(),
        start_before: monthEnd.toISOString(),
      }),
    enabled: Boolean(ownerId),
  });

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (eventsQuery.isError) {
    return (
      <div className="page">
        <div className="error-banner">加载日程失败: {String(eventsQuery.error)}</div>
      </div>
    );
  }

  const events = eventsQuery.data ?? [];
  const groups = groupByDay(events);
  const isLoading = eventsQuery.isLoading;

  const days = Object.keys(groups)
    .filter((dayKey) => isDateInMonth(new Date(dayKey), monthStart, monthEnd))
    .sort();

  const isCurrentMonth = monthOffset === 0;

  return (
    <div className="page">
      <PageHeader
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setMonthOffset(monthOffset - 1)}
              aria-label="上个月"
            >
              ‹
            </button>
            <span>
              {isCurrentMonth ? `${formatMonthLabel(monthStart)}（本月）` : formatMonthLabel(monthStart)}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setMonthOffset(monthOffset + 1)}
              aria-label="下个月"
            >
              ›
            </button>
          </span>
        }
        subtitle={
          <>
            {events.length} 个日程
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="btn-ghost"
                style={{ fontSize: 12, padding: '0 4px', color: 'var(--accent)' }}
              >
                回到本月
              </button>
            )}
          </>
        }
        actions={
          <Link to="/events/new" className="btn btn-primary">
            + 新建日程
          </Link>
        }
      />

      {isLoading ? (
        <div className="loading">加载中</div>
      ) : days.length === 0 ? (
        <div className="empty-state">
          <h3 className="empty-state__title">这个月没有日程</h3>
          <p className="empty-state__hint">加一个会面、纪念日或 deadline。</p>
          <Link to="/events/new" className="btn btn-primary">
            + 创建第一个日程
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          {days.map((dayKey) => {
            const dayDate = new Date(dayKey);
            const dayEvents = groups[dayKey];
            return (
              <section key={dayKey} className="section" style={{ marginBottom: 0 }}>
                <div className="section__header">
                  <h2 className="section__title">{formatDayLabel(dayDate)}</h2>
                  <span className="text-sm text-muted">{dayEvents.length} 个日程</span>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {dayEvents.map((event) => {
                    const startAt = new Date(event.start_at);
                    const endAt = event.end_at ? new Date(event.end_at) : null;
                    const timeLabel = endAt
                      ? `${formatTime(startAt)} – ${formatTime(endAt)}`
                      : formatTime(startAt);
                    const subtitle = timeLabel + (event.location ? ` · ${event.location}` : '');
                    return (
                      <Link
                        key={event.id}
                        to={`/events/${event.id}`}
                        className="row-card"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <span style={{ fontSize: 18 }}>📅</span>
                        <span className="row-card__title">{event.title}</span>
                        <span className="row-card__meta">{subtitle}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}