'use client';

import { useTransition } from 'react';
import { deleteInteractionAction } from '@/app/contacts/[id]/actions';

interface Item {
  id: string;
  occurredAt: string;
  channel: string | null;
  summary: string;
}

function DeleteButton({ contactId, id }: { contactId: string; id: string }) {
  const [, startTransition] = useTransition();

  async function handleDelete() {
    if (!confirm('确认删除？')) return;
    await deleteInteractionAction(contactId, id);
    // revalidatePath is called inside the server action — no router.refresh() needed
  }

  return (
    <button
      onClick={handleDelete}
      className="text-red-600 hover:underline"
      type="button"
      aria-label="删除此互动"
    >
      删除
    </button>
  );
}

export function InteractionTimeline({
  contactId,
  items,
}: {
  contactId: string;
  items: Item[];
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-gray-500">还没有互动</p>;
  }

  return (
    <ol className="mt-3 space-y-2">
      {items.map((i) => (
        <li
          key={i.id}
          className="card border-l-4 border-l-accent"
        >
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {new Date(i.occurredAt).toLocaleString('zh-CN')}
              {i.channel ? ` · ${i.channel}` : ''}
            </span>
            <DeleteButton contactId={contactId} id={i.id} />
          </div>
          <p className="mt-1 whitespace-pre-wrap">{i.summary}</p>
        </li>
      ))}
    </ol>
  );
}
