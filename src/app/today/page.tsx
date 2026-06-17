import { TimelineService } from '@/server/services/timeline';
import Link from 'next/link';

export default async function TodayPage() {
  const { todayEvents, dueActions, recentInteractions } = await TimelineService.forToday();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">今天</h1>

      {todayEvents.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium text-gray-700">📅 今日日程</h2>
          <div className="mt-2 space-y-2">
            {todayEvents.map(e => (
              <Link key={e.id} href={e.link} className="flex items-center gap-3 rounded border p-3 hover:bg-gray-50">
                <span className="text-sm font-medium text-gray-600">{e.subtitle}</span>
                <span className="font-medium">{e.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-medium text-gray-700">☑ 待处理</h2>
        {dueActions.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">没有待处理的 Action</p>
        ) : (
          <div className="mt-2 space-y-2">
            {dueActions.map(a => {
              const isOverdue = a.timestamp < new Date();
              return (
                <Link key={a.id} href={a.link} className={`flex items-center justify-between rounded border p-3 hover:bg-gray-50 ${isOverdue ? 'border-red-200 bg-red-50' : ''}`}>
                  <div>
                    <span className="font-medium">{a.title}</span>
                    <span className="ml-2 text-xs text-gray-500">{a.subtitle}</span>
                  </div>
                  <span className={`whitespace-nowrap text-xs ${isOverdue ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                    {isOverdue ? '已过期' : statusLabel(a.status)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {recentInteractions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium text-gray-700">📝 近期互动</h2>
          <div className="mt-2 space-y-1">
            {recentInteractions.map(i => (
              <div key={i.id} className="flex items-start gap-2 py-1 text-sm">
                <span className="whitespace-nowrap text-gray-400">{i.timestamp.toLocaleDateString('zh-CN')}</span>
                {i.contactName && <span className="font-medium text-gray-600">{i.contactName}</span>}
                <span className="line-clamp-1 text-gray-700">{i.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'inbox': return '收件箱';
    case 'open': return '待办';
    case 'waiting': return '等待';
    case 'done': return '已完成';
    default: return s ?? '';
  }
}
