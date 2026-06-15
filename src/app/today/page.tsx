import Link from 'next/link';
import { ActionService } from '@/server/services/action';
import { PushToggle } from '@/components/push-toggle';
import { TransitionAction } from './transition-action';

function dueColor(dueAt: Date): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate());
  const days = Math.floor((target.getTime() - start.getTime()) / 86400_000);
  if (days < 0) return 'text-red-600 font-semibold';
  if (days === 0) return 'text-orange-600 font-semibold';
  if (days <= 3) return 'text-yellow-700 font-medium';
  return 'text-gray-500';
}

function dueLabel(dueAt: Date): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate());
  const days = Math.floor((target.getTime() - start.getTime()) / 86400_000);
  if (days < 0) return `已过期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days <= 7) return `${days} 天后`;
  return dueAt.toLocaleDateString('zh-CN');
}

function waitingAgeColor(updatedAt: Date): string {
  const days = Math.floor((Date.now() - updatedAt.getTime()) / 86400_000);
  if (days > 7) return 'text-red-600 font-semibold';
  if (days > 3) return 'text-orange-600';
  return 'text-gray-500';
}

function ActionRow({
  id,
  title,
  dueAt,
  priority,
  contact,
  waitingOn,
  status,
  updatedAt,
  showTransition = true,
}: {
  id: string;
  title: string;
  dueAt: Date | null;
  priority: number;
  contact: { id: string; name: string } | null;
  waitingOn: { id: string; name: string } | null;
  status?: string;
  updatedAt?: Date;
  showTransition?: boolean;
}) {
  return (
    <li className="card flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {dueAt && (
            <span className={`text-xs ${dueColor(dueAt)}`}>{dueLabel(dueAt)}</span>
          )}
          {priority >= 7 && (
            <span className="rounded bg-red-100 px-1.5 text-xs text-red-700">P{priority}</span>
          )}
          {priority > 0 && priority < 7 && (
            <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">P{priority}</span>
          )}
          <Link className="font-medium hover:underline" href={`/actions/${id}`}>{title}</Link>
        </div>
        <div className="mt-0.5 text-xs text-gray-500">
          {contact && <Link className="text-accent" href={`/contacts/${contact.id}`}>→ {contact.name}</Link>}
          {waitingOn && <span className="ml-2 text-orange-600">等 {waitingOn.name}</span>}
          {updatedAt && status === 'waiting' && (
            <span className={`ml-2 ${waitingAgeColor(updatedAt)}`}>
              {Math.floor((Date.now() - updatedAt.getTime()) / 86400_000)} 天前
            </span>
          )}
        </div>
      </div>
      {showTransition && status && (
        <TransitionAction id={id} currentStatus={status as any} />
      )}
    </li>
  );
}

export default async function TodayPage() {
  const snap = await ActionService.today();

  const hasAny =
    snap.today.length + snap.upcoming.length + snap.waiting.length + snap.needsAttention.length > 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">今天</h1>
          <p className="mt-1 text-sm text-gray-500">
            {new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <PushToggle />
          <Link className="btn-primary text-sm" href="/actions/new">+ Action</Link>
        </div>
      </header>

      {!hasAny && (
        <div className="card text-center text-gray-500">
          还没有任何 Action。<Link className="text-accent" href="/actions/new">创建一个</Link> 开始管理你的任务和人脉。
        </div>
      )}

      {snap.today.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700">⏰ 今天 ({snap.today.length})</h2>
          <ul className="mt-2 space-y-2">
            {snap.today.map((a) => (
              <ActionRow
                key={a.id}
                id={a.id}
                title={a.title}
                dueAt={a.dueAt}
                priority={a.priority}
                contact={a.contact}
                waitingOn={a.waitingOn}
                status={a.status}
                updatedAt={a.updatedAt}
              />
            ))}
          </ul>
        </section>
      )}

      {snap.upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700">📅 即将到期 ({snap.upcoming.length})</h2>
          <ul className="mt-2 space-y-2">
            {snap.upcoming.map((a) => (
              <ActionRow
                key={a.id}
                id={a.id}
                title={a.title}
                dueAt={a.dueAt}
                priority={a.priority}
                contact={a.contact}
                waitingOn={a.waitingOn}
                status={a.status}
                updatedAt={a.updatedAt}
              />
            ))}
          </ul>
        </section>
      )}

      {snap.waiting.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700">
            ⏳ 等待回复 ({snap.waiting.length})
            <span className="ml-2 text-xs text-gray-400">超过 7 天标红</span>
          </h2>
          <ul className="mt-2 space-y-2">
            {snap.waiting.map((a) => (
              <ActionRow
                key={a.id}
                id={a.id}
                title={a.title}
                dueAt={a.dueAt}
                priority={a.priority}
                contact={a.contact}
                waitingOn={a.waitingOn}
                status={a.status}
                updatedAt={a.updatedAt}
              />
            ))}
          </ul>
        </section>
      )}

      {snap.needsAttention.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700">👥 今天该联系 ({snap.needsAttention.length})</h2>
          <p className="mt-1 text-xs text-gray-400">超过 90 天未联系的联系人</p>
          <ul className="mt-2 space-y-2">
            {snap.needsAttention.map((c) => (
              <li key={c.id} className="card flex items-center justify-between">
                <div>
                  <Link className="font-medium hover:underline" href={`/contacts/${c.id}`}>{c.name}</Link>
                  <div className="text-xs text-gray-500">
                    {c.lastContactedAt
                      ? `已 ${Math.floor((Date.now() - c.lastContactedAt.getTime()) / 86400_000)} 天未联系`
                      : '从未联系'}
                  </div>
                </div>
                <Link className="btn-secondary text-sm" href={`/contacts/${c.id}#action`}>+ Action</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
