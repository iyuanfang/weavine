import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Event } from '../lib/adapter/types';

// ── Helpers ──────────────────────────────────────────

/** Return the first day of the month, adjusted by monthOffset. */
function getMonthStart(base: Date, monthOffset: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return the last day of the month, adjusted by monthOffset. */
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

/** Group events by the local date string 'YYYY-MM-DD'. */
function groupByDay(events: Event[]): Record<string, Event[]> {
  const groups: Record<string, Event[]> = {};
  for (const e of events) {
    const d = new Date(e.start_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }
  // Sort each group by start time
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }
  return groups;
}

/** Check if a date falls within the target month. */
function isDateInMonth(d: Date, monthStart: Date, monthEnd: Date): boolean {
  const t = d.getTime();
  return t >= monthStart.getTime() && t <= monthEnd.getTime();
}

// ── Page component ───────────────────────────────────

export function Calendar() {
  const adapter = useAdapter();
  const ownerId = useOwnerId();

  const [monthOffset, setMonthOffset] = useState(0);

  // Compute month boundaries
  const { monthStart, monthEnd } = useMemo(() => {
    const now = new Date();
    const start = getMonthStart(now, monthOffset);
    const end = getMonthEnd(now, monthOffset);
    return { monthStart: start, monthEnd: end };
  }, [monthOffset]);

  // Fetch all events in the target month
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

  // ── Guards ───────────────────────────────────────

  if (!ownerId) {
    return <div className="loading">正在加载用户…</div>;
  }

  if (eventsQuery.isError) {
    return (
      <div className="today-page">
        <div className="error">加载失败: {String(eventsQuery.error)}</div>
      </div>
    );
  }

  // ── Derived state ────────────────────────────────

  const events = eventsQuery.data ?? [];
  const groups = groupByDay(events);
  const isLoading = eventsQuery.isLoading;

  // Collect all days that have events, sorted chronologically
  const days = Object.keys(groups)
    .filter((dayKey) => {
      const d = new Date(dayKey);
      return isDateInMonth(d, monthStart, monthEnd);
    })
    .sort();

  const isCurrentMonth = monthOffset === 0;

  // ── Render ───────────────────────────────────────

  return (
    <div className="today-page">
      {/* Header with month label and navigation */}
      <div className="section__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setMonthOffset(monthOffset - 1)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 14,
              cursor: 'pointer',
              color: 'var(--fg)',
            }}
          >
            ‹
          </button>
          <h1 className="section__title">
            {isCurrentMonth
              ? `${formatMonthLabel(monthStart)}（本月）`
              : formatMonthLabel(monthStart)}
          </h1>
          <button
            onClick={() => setMonthOffset(monthOffset + 1)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 14,
              cursor: 'pointer',
              color: 'var(--fg)',
            }}
          >
            ›
          </button>
        </div>
        {monthOffset !== 0 && (
          <button
            onClick={() => setMonthOffset(0)}
            style={{
              fontSize: 12,
              color: 'var(--accent)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            回到本月
          </button>
        )}
      </div>

      {/* Floating "+ 新建" button */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: 'var(--accent)',
          color: '#fff',
          borderRadius: 999,
          padding: '10px 18px',
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
          cursor: 'pointer',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Link to="/events/new" style={{ color: '#fff', textDecoration: 'none' }}>
          + 新建
        </Link>
      </div>

      {/* Calendar content */}
      {isLoading ? (
        <div className="loading">…</div>
      ) : days.length === 0 ? (
        <div className="empty-state">
          <p>这个月没有日程</p>
          <Link
            to="/events/new"
            style={{ display: 'inline-block', marginTop: 8, color: 'var(--accent)', fontSize: 13 }}
          >
            + 创建第一个日程
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {days.map((dayKey) => {
            const dayDate = new Date(dayKey);
            const dayEvents = groups[dayKey];
            return (
              <section key={dayKey} className="section" style={{ marginBottom: 16 }}>
                <div className="section__header">
                  <h2 className="section__title">{formatDayLabel(dayDate)}</h2>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {dayEvents.length} 个日程
                  </span>
                </div>
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
                      style={{ textDecoration: 'none' }}
                    >
                      <span className="row-card__title">{event.title}</span>
                      <span className="row-card__meta">{subtitle}</span>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}