import { TimelineService } from '@/server/services/timeline';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { ActionRow } from '@/components/action-row';

export default async function TodayPage() {
  const { id: ownerId } = await getCurrentUser();
  const { todayDoActions, upcomingEvents, recentInteractions } =
    await TimelineService.forToday(ownerId);

  return (
    <main className="today-page mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">今天</h1>

      <section className="mt-6">
        <SectionHeader
          title="🎯 今日要做"
          viewAllHref="/actions"
        />
        {todayDoActions.length > 0 ? (
          <div className="mt-2 space-y-2">
            {todayDoActions.map(a => (
              <ActionRow
                key={a.id}
                id={a.id}
                title={a.title}
                subtitle={a.subtitle}
                href={a.link}
                tone={a.timestamp < new Date() ? 'overdue' : 'today'}
                priority={a.priority ?? 0}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
            🎉 今天没有到期的事
          </p>
        )}
      </section>

      <section className="mt-6">
        <SectionHeader
          title="📅 最近日程"
          viewAllHref="/calendar"
        />
        {upcomingEvents.length > 0 ? (
          <div className="mt-2 space-y-2">
            {upcomingEvents.map(e => (
              <Link
                key={e.id}
                href={e.link}
                className="flex items-center gap-2 rounded border border-blue-100 bg-blue-50/40 p-3 transition-colors hover:border-blue-200 hover:bg-blue-50"
              >
                <span className="font-medium text-gray-900">{e.title}</span>
                <span className="truncate text-xs text-gray-500">{e.subtitle}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
            最近没有日程
          </p>
        )}
      </section>

      <section className="mt-6">
        <SectionHeader
          title="📝 近期互动"
          viewAllHref="/contacts"
        />
        {recentInteractions.length > 0 ? (
          <div className="mt-2 space-y-1">
            {recentInteractions.map(i => (
              <Link
                key={i.id}
                href={i.link}
                className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
              >
                <span className="shrink-0 whitespace-nowrap text-xs text-gray-400 tabular-nums">
                  {i.timestamp.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                </span>
                {i.contactName && (
                  <span className="shrink-0 font-medium text-gray-600">{i.contactName}</span>
                )}
                <span className="line-clamp-1 text-gray-700">{i.title}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
            最近 7 天没有互动
          </p>
        )}
      </section>
    </main>
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
    <div className="flex items-end justify-between">
      <h2 className="text-lg font-medium text-gray-800">{title}</h2>
      <Link
        href={viewAllHref}
        className="text-xs text-gray-400 transition-colors hover:text-accent"
      >
        全部 →
      </Link>
    </div>
  );
}