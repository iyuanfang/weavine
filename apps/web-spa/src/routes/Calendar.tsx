import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/PageHeader';
import { ProjectBadge } from '../components/ProjectBadge';
import { EVENT_PRESETS, categoryMeta } from '../components/categoryPresets';
import { useAdapter } from '../lib/adapter';
import { useOwnerId } from '../lib/auth';
import type { Event } from '../lib/adapter/types';

const TYPE_OPTIONS = [
  { value: 'all', label: '全部', icon: '●', color: '#6b7280' },
  ...EVENT_PRESETS,
];

const TYPE_COLOR = Object.fromEntries(EVENT_PRESETS.map((p) => [p.value, p.color]));

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

function formatShortDayLabel(d: Date): string {
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' });
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [monthOffset, setMonthOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { monthStart, monthEnd } = useMemo(() => {
    const now = new Date();
    return {
      monthStart: getMonthStart(now, monthOffset),
      monthEnd: getMonthEnd(now, monthOffset),
    };
  }, [monthOffset]);

  const eventsQuery = useQuery({
    queryKey: ['events', ownerId, 'by-month', monthOffset, 'active'],
    queryFn: () =>
      adapter.events.list({
        owner_id: ownerId!,
        start_after: monthStart.toISOString(),
        start_before: monthEnd.toISOString(),
        archived: 'false',
      }),
    enabled: Boolean(ownerId),
    refetchOnMount: 'always',
  });

  const upcomingQuery = useQuery({
    queryKey: ['events', ownerId, 'upcoming'],
    queryFn: () => adapter.events.upcoming(ownerId!, 5),
    enabled: Boolean(ownerId),
    refetchOnMount: 'always',
  });

  const archiveCountsQuery = useQuery({
    queryKey: ['archive', 'counts', ownerId],
    queryFn: () => adapter.archive.counts(ownerId!),
    enabled: !!ownerId,
    refetchOnMount: 'always',
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => adapter.events.delete(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const handleDelete = (event: Event) => {
    if (confirm(`确定要删除「${event.title}」吗？`)) {
      deleteMutation.mutate(event.id);
    }
  };

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

  const allEvents = eventsQuery.data ?? [];
  const visible =
    typeFilter === 'all' ? allEvents : allEvents.filter((e) => e.type === typeFilter);

  const groups = groupByDay(visible);
  const days = Object.keys(groups)
    .filter((dayKey) => isDateInMonth(new Date(dayKey), monthStart, monthEnd))
    .sort();

  const countsByType = TYPE_OPTIONS.reduce<Record<string, number>>((acc, t) => {
    acc[t.value] =
      t.value === 'all'
        ? allEvents.length
        : allEvents.filter((e) => e.type === t.value).length;
    return acc;
  }, {});

  const isLoading = eventsQuery.isLoading;
  const isCurrentMonth = monthOffset === 0;
  const upcoming = upcomingQuery.data ?? [];

  return (
    <div className="page">
      <PageHeader
        title={
          <span>
            {isCurrentMonth
              ? `${formatMonthLabel(monthStart)}（本月）`
              : formatMonthLabel(monthStart)}
          </span>
        }
        subtitle={
          <>
            {visible.length} 个日程 · {days} 天
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="btn-ghost"
                style={{ fontSize: 'var(--text-sm)', padding: '0 4px', color: 'var(--accent)' }}
              >
                回到本月
              </button>
            )}
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setMonthOffset(monthOffset - 1)}
              aria-label="上个月"
            >
              ‹
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setMonthOffset(monthOffset + 1)}
              aria-label="下个月"
            >
              ›
            </button>
            <Link to="/events/new" className="btn btn-primary">
              + 新建日程
            </Link>
          </div>
        }
      />

      <div className="layout-split">
        <aside className="filter-panel">
          <div className="filter-panel__section">
            <div className="filter-panel__title">月份</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 10px',
              }}
            >
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setMonthOffset(monthOffset - 1)}
                aria-label="上个月"
              >
                ‹
              </button>
              <span style={{ fontSize: 'var(--text-base)', fontWeight: 500 }}>
                {formatMonthLabel(monthStart)}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setMonthOffset(monthOffset + 1)}
                aria-label="下个月"
              >
                ›
              </button>
            </div>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="filter-panel__item"
                style={{ color: 'var(--accent)', fontWeight: 500 }}
              >
                <span>← 回到本月</span>
              </button>
            )}
          </div>

          <div className="filter-panel__divider" />

          <div className="filter-panel__section">
            <div className="filter-panel__title">类型</div>
            {TYPE_OPTIONS.map((t) => {
              const active = typeFilter === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTypeFilter(t.value)}
                  className={`filter-panel__item ${active ? 'filter-panel__item--active' : ''}`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {t.value === 'all' ? (
                      <span style={{ fontSize: 'var(--text-base)' }}>●</span>
                    ) : (
                      <span
                        className="filter-panel__item-dot"
                        style={{ background: t.color }}
                      />
                    )}
                    <span>{t.label}</span>
                  </span>
                  <span className="filter-panel__count">{countsByType[t.value] ?? 0}</span>
                </button>
              );
            })}
          </div>

          {upcoming.length > 0 && (
            <>
              <div className="filter-panel__divider" />
              <div className="filter-panel__section">
                <div className="filter-panel__title">即将到来</div>
                {upcoming.map((e) => {
                  const start = new Date(e.start_at);
                  const isToday = start.toDateString() === new Date().toDateString();
                  return (
                    <Link
                      key={e.id}
                      to={`/events/${e.id}`}
                      className="filter-panel__item"
                      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px' }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                        <span
                          className="filter-panel__item-dot"
                          style={{
                            background: TYPE_COLOR[e.type ?? ''] ?? '#9ca3af',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 'var(--text-base)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {e.title}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: isToday ? 'var(--warn)' : 'var(--muted)',
                          fontWeight: isToday ? 500 : 400,
                        }}
                      >
                        {isToday ? `今天 ${formatTime(start)}` : formatShortDayLabel(start)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {archiveCountsQuery.data && archiveCountsQuery.data.event > 0 && (
            <>
              <div className="filter-panel__divider" />
              <div className="filter-panel__section">
                <Link
                  to="/archive"
                  className="filter-panel__item"
                  style={{ opacity: 0.7 }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📦</span>
                    <span>已归档 {archiveCountsQuery.data.event} 项</span>
                  </span>
                  <span aria-hidden>查看 →</span>
                </Link>
              </div>
            </>
          )}
        </aside>

        <div className="layout-split__main">
          {isLoading ? (
            <div className="loading">加载中</div>
          ) : days.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">这个月没有日程</h3>
              <p className="empty-state__hint">
                {typeFilter !== 'all'
                  ? `切换到「全部」或选其他类型。`
                  : '加一个会面、纪念日或 deadline。'}
              </p>
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
                        const meta = categoryMeta(event.type, EVENT_PRESETS);
                        const icon = meta.icon;
                        const color = meta.color;
                        return (
                          <Link
                            key={event.id}
                            to={`/events/${event.id}`}
                            className="row-card"
                            onMouseEnter={() => setHoveredId(event.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                          >
                            <span
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                background: `${color}18`,
                                color,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'var(--text-base)',
                                flexShrink: 0,
                              }}
                            >
                              {icon}
                            </span>
                            <span className="row-card__title">{event.title}</span>
                            <span
                              className="cluster"
                              style={{ minWidth: 0 }}
                            >
                              <span className="row-card__meta">{subtitle}</span>
                              {event.project_id && event.project_title && (
                                <ProjectBadge
                                  project={{
                                    id: event.project_id,
                                    title: event.project_title,
                                    template: 'general',
                                    stage: 'planning',
                                  }}
                                />
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate(`/events/${event.id}/edit`);
                              }}
                              className="btn btn-sm btn-ghost"
                              style={{
                                padding: '2px 6px',
                                fontSize: 'var(--text-sm)',
                                opacity: hoveredId === event.id ? 1 : 0.55,
                                transition: `opacity var(--transition)`,
                              }}
                              title="编辑"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDelete(event);
                              }}
                              className="btn btn-sm btn-ghost"
                              style={{
                                padding: '2px 6px',
                                fontSize: 'var(--text-sm)',
                                color: 'var(--danger)',
                                opacity: hoveredId === event.id ? 1 : 0,
                                transition: `opacity var(--transition)`,
                              }}
                              title="删除"
                            >
                              🗑
                            </button>
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
      </div>
    </div>
  );
}