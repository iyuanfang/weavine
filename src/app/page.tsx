import Link from 'next/link';
import { DashboardService } from '@/server/services/dashboard';
import { PushToggle } from '@/components/push-toggle';

export default async function Home() {
  let snapshot;
  try {
    snapshot = await DashboardService.snapshot();
  } catch {
    snapshot = null;
  }
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">PRM · 人脉管理</h1>
          <p className="mt-2 text-gray-600">记录联系人、见面、需求，保持关系网鲜活。</p>
        </div>
        <PushToggle />
      </header>
      {snapshot ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="联系人" value={snapshot.contacts} href="/contacts" />
            <Stat label="进行中需求" value={snapshot.activeNeeds} href="/needs" />
            <Stat label="未读消息" value={snapshot.unreadInbox} href="/inbox" />
            <Stat label="近期生日" value={snapshot.upcomingBirthdays.length} href="/contacts" />
          </div>

          {snapshot.upcomingEvents.length > 0 && (
            <section>
              <h2 className="font-semibold">即将到来的事件</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {snapshot.upcomingEvents.map((e: any) => (
                  <li key={e.id}>
                    <Link className="text-accent" href={`/events/${e.id}`}>
                      {e.startAt.toLocaleString('zh-CN')} · {e.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {snapshot.upcomingBirthdays.length > 0 && (
            <section>
              <h2 className="font-semibold">近期生日</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {snapshot.upcomingBirthdays.map((b: { id: string; name: string; when: Date }) => (
                  <li key={b.id}>
                    <Link className="text-accent" href={`/contacts/${b.id}`}>
                      {b.name} · {b.when.toLocaleDateString('zh-CN')}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {snapshot.needsAttention.length > 0 && (
            <section>
              <h2 className="font-semibold">需要回访</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {snapshot.needsAttention.map((c: any) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <Link className="text-accent" href={`/contacts/${c.id}`}>
                      {c.name}
                    </Link>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${c.info.badgeColor}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${c.info.dotColor}`} />
                      {c.info.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-500">数据加载失败。</p>
      )}
      <nav className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <Link className="btn-secondary" href="/contacts">→ 联系人</Link>
        <Link className="btn-secondary" href="/calendar">→ 日程</Link>
        <Link className="btn-secondary" href="/needs">→ 需求</Link>
        <Link className="btn-secondary" href="/search">→ 搜索</Link>
        <Link className="btn-secondary" href="/tags">→ 标签</Link>
        <Link className="btn-secondary" href="/settings">→ 设置</Link>
      </nav>
    </main>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded border border-gray-200 p-3 hover:bg-gray-50">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-gray-500 text-sm">{label}</div>
    </Link>
  );
}
