import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth/session';

interface Props {
  contactId: string;
  lastContactedAt: Date | null;
}

export async function NextStepPanel({ contactId, lastContactedAt }: Props) {
  const { id: ownerId } = await getCurrentUser();

  const [pendingActions, upcomingEvents] = await Promise.all([
    prisma.action.findMany({
      where: {
        contactId,
        ownerId,
        status: { in: ['inbox', 'open', 'waiting'] },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 5,
      select: { id: true, title: true, dueAt: true, priority: true },
    }),
    prisma.event.findMany({
      where: {
        contactId,
        ownerId,
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: 'asc' },
      take: 3,
      select: { id: true, title: true, startAt: true, type: true },
    }),
  ]);

  const hasItems = pendingActions.length > 0 || upcomingEvents.length > 0;
  const daysSince = lastContactedAt
    ? Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const priorityLabel = ['普通', '重要', '紧急'] as const;

  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold mb-3">下一步动作</h2>

      {!hasItems && daysSince !== null && (
        <p className="text-sm text-gray-500 mb-3">上次联系：{daysSince} 天前</p>
      )}

      {pendingActions.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {pendingActions.map((a) => (
            <Link
              key={a.id}
              href={`/actions/${a.id}`}
              className="flex items-center gap-2 text-sm hover:underline"
            >
              <span className="text-gray-400">☐</span>
              <span className="flex-1 truncate">{a.title}</span>
              {a.dueAt && (
                <span className="shrink-0 text-xs text-gray-500">
                  {new Date(a.dueAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
              )}
              {a.priority > 0 && (
                <span className="shrink-0 rounded bg-red-50 px-1 text-xs text-red-500">
                  {priorityLabel[a.priority]}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {upcomingEvents.length > 0 && (
        <div className="mb-3 space-y-1.5 border-t border-gray-100 pt-2">
          {upcomingEvents.map((e) => (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              className="flex items-center gap-2 text-sm hover:underline"
            >
              <span className="text-gray-400">📅</span>
              <span className="flex-1 truncate">{e.title}</span>
              <span className="shrink-0 text-xs text-gray-500">
                {new Date(e.startAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-gray-100 pt-3">
        <Link href={`/actions/new?contactId=${contactId}`} className="btn-primary text-xs">
          + 待办
        </Link>
        <Link href={`/events/new?contactId=${contactId}`} className="btn-secondary text-xs">
          + 日程
        </Link>
      </div>
    </div>
  );
}
