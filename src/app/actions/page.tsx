import Link from 'next/link';
import { ActionService } from '@/server/services/action';
import type { ActionStatus } from '@/server/services/action';
import { TransitionAction } from '../today/transition-action';

const COLS = [
  { key: 'inbox', label: '📥 收件箱', desc: '刚捕获' },
  { key: 'open', label: '🎯 待办', desc: '下一步可执行' },
  { key: 'waiting', label: '⏳ 等待', desc: '在等某人回复' },
  { key: 'done', label: '✅ 完成', desc: '今日完成' },
] as const;

export default async function ActionsKanban() {
  const groups = await ActionService.kanban();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Action 看板</h1>
        <Link className="btn-primary" href="/actions/new">+ 新建</Link>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {COLS.map((col) => (
          <section
            key={col.key}
            className="min-h-[60vh] rounded border border-gray-200 bg-gray-50 p-3"
          >
            <header className="mb-2">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{col.label}</span>
                <span className="rounded bg-white px-2 text-xs text-gray-500">
                  {groups[col.key]?.length ?? 0}
                </span>
              </div>
              <p className="text-xs text-gray-400">{col.desc}</p>
            </header>
            <ul className="space-y-2">
              {(groups[col.key] ?? []).map((a) => (
                <li key={a.id} className="card">
                  <Link className="font-medium hover:underline" href={`/actions/${a.id}`}>
                    {a.title}
                  </Link>
                  <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {a.dueAt ? a.dueAt.toLocaleDateString('zh-CN') : '无日期'}
                      {a.priority > 0 && ` · P${a.priority}`}
                    </span>
                  </div>
                  {(a.contact || a.waitingOn) && (
                    <div className="mt-1 text-xs">
                      {a.contact && <span className="text-accent">→ {a.contact.name}</span>}
                      {a.waitingOn && <span className="ml-2 text-orange-600">等 {a.waitingOn.name}</span>}
                    </div>
                  )}
                  <div className="mt-2">
                    <TransitionAction id={a.id} currentStatus={a.status as ActionStatus} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
