import Link from 'next/link';
import { ActionService } from '@/server/services/action';
import { ContactService } from '@/server/services/contact';
import { KanbanBoard } from '@/components/kanban-board';
import { getCurrentUser } from '@/lib/auth/session';

const COLS = ['inbox', 'open', 'waiting', 'done'] as const;

export default async function ActionsKanban() {
  const { id: ownerId } = await getCurrentUser();
  const [groups, contacts] = await Promise.all([
    ActionService.kanban(ownerId),
    ContactService.listLight(ownerId),
  ]);

  const mapped: Record<string, { id: string; title: string; status: string; dueAt: string | null; priority: number; contact: { nickname: string; name: string | null } | null }[]> = {};
  for (const key of COLS) {
    mapped[key] = (groups[key] ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      dueAt: a.dueAt?.toISOString() ?? null,
      priority: a.priority,
      contact: a.contact ? { nickname: a.contact.nickname, name: a.contact.name } : null,
    }));
  }

  const totalCount = Object.values(mapped).reduce((sum, g) => sum + g.length, 0);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">待办看板</h1>
        <Link className="btn-secondary" href="/actions/new">+ 新建（详细）</Link>
      </div>
      {totalCount === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">看板是空的。从一个具体的小事开始：</p>
          <ol className="mx-auto mt-3 max-w-md space-y-2 text-left text-sm text-gray-700">
            <li><span className="font-medium text-accent">1.</span> 点下面任意一列底部的「+ 添加」</li>
            <li><span className="font-medium text-accent">2.</span> 写下标题，回车保存（自动进入对应列）</li>
            <li><span className="font-medium text-accent">3.</span> 拖到「进行中」开始推进；卡住就拖到「等待中」</li>
          </ol>
        </div>
      ) : (
        <KanbanBoard groups={mapped} contacts={contacts} />
      )}
    </main>
  );
}
