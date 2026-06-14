import Link from 'next/link';
import { InboxService } from '@/server/services/inbox';
import { markReadAction, markAllReadAction, deleteInboxItemAction } from './actions';

export default async function InboxPage() {
  const [items, unreadCount] = await Promise.all([
    InboxService.list(),
    InboxService.unreadCount(),
  ]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          收件箱
          {unreadCount > 0 && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-sm text-red-600">
              {unreadCount}
            </span>
          )}
        </h1>
        {unreadCount > 0 && (
          <form action={markAllReadAction}>
            <button className="btn-secondary text-sm">全部已读</button>
          </form>
        )}
      </div>

      <ul className="mt-4 divide-y">
        {items.length === 0 ? (
          <li className="py-6 text-center text-sm text-gray-500">
            没有消息
          </li>
        ) : (
          items.map((i) => (
            <li
              key={i.id}
              className={`flex items-start gap-3 py-3 ${i.read ? 'opacity-60' : ''}`}
            >
              <div className="flex-1">
                <div className="font-medium">{i.title}</div>
                <div className="text-sm text-gray-600">{i.body}</div>
                <div className="mt-0.5 text-xs text-gray-400">
                  {i.createdAt.toLocaleString('zh-CN')}
                  {i.link && (
                    <Link className="ml-2 text-accent" href={i.link}>
                      查看 →
                    </Link>
                  )}
                </div>
              </div>
              {!i.read && (
                <form action={markReadAction.bind(null, i.id)}>
                  <button className="btn-secondary">已读</button>
                </form>
              )}
              <form action={deleteInboxItemAction.bind(null, i.id)}>
                <button className="btn-danger">删</button>
              </form>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
