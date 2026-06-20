import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InteractionService } from '@/server/services/interaction';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { InteractionEditForm } from '@/components/interaction-edit-form';
import { deleteInteractionFromDetailAction } from '@/app/interactions/actions';
import { getCurrentUser } from '@/lib/auth/session';

export default async function InteractionDetail({
  params,
}: {
  params: { id: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  let i;
  try {
    i = await InteractionService.get(params.id, ownerId);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">互动详情</h1>
        <div className="flex gap-2">
          {i.contactId && (
            <Link className="btn-secondary" href={`/contacts/${i.contactId}`}>
              ← 返回联系人
            </Link>
          )}
          <ConfirmDeleteForm action={deleteInteractionFromDetailAction.bind(null, i.id)}>
            <button className="btn-danger" aria-label="删除">删除</button>
          </ConfirmDeleteForm>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="font-semibold">关联</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {i.contact && (
            <li>
              👤{' '}
              <Link
                className="text-accent hover:underline"
                href={`/contacts/${i.contact.id}`}
              >
                {i.contact.nickname ?? i.contact.name ?? '?'}
              </Link>
            </li>
          )}
          {i.event && (
            <li>
              📅{' '}
              <Link
                className="text-accent hover:underline"
                href={`/events/${i.event.id}`}
              >
                {i.event.title}
              </Link>
            </li>
          )}
          {i.action && (
            <li>
              ☑{' '}
              <Link
                className="text-accent hover:underline"
                href={`/actions/${i.action.id}`}
              >
                {i.action.title}
              </Link>
            </li>
          )}
          {!i.contact && !i.event && !i.action && (
            <li className="text-gray-500">无关联记录</li>
          )}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">编辑</h2>
        <InteractionEditForm
          id={i.id}
          initial={{
            occurredAt: new Date(i.occurredAt),
            channel: i.channel,
            summary: i.summary,
          }}
        />
      </section>
    </main>
  );
}
