'use client';

import { deleteInteractionAction } from '@/app/contacts/[id]/actions';

interface Item {
  id: string;
  occurredAt: string;
  channel: string | null;
  summary: string;
}

export function InteractionTimeline({
  contactId,
  items,
}: {
  contactId: string;
  items: Item[];
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-gray-500">还没有互动记录</p>;
  }

  return (
    <ol className="mt-3 space-y-2">
      {items.map((i) => (
        <li
          key={i.id}
          className="rounded border border-l-4 border-l-accent p-3 text-sm"
        >
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {new Date(i.occurredAt).toLocaleString('zh-CN')}
              {i.channel ? ` · ${i.channel}` : ''}
            </span>
            <form
              action={deleteInteractionAction.bind(null, contactId, i.id)}
            >
              <button className="text-red-600 hover:underline" type="submit">
                删除
              </button>
            </form>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{i.summary}</p>
        </li>
      ))}
    </ol>
  );
}
