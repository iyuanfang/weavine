import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ActionService } from '@/server/services/action';
import type { ActionStatus } from '@/server/services/action';
import { TransitionAction } from '@/app/today/transition-action';
import { deleteAction } from '@/app/actions/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { CompleteActionForm } from '@/components/complete-action-form';

async function completeAction(formData: FormData) {
  'use server';
  const id = formData.get('actionId') as string;
  const result = (formData.get('result') as string)?.trim();
  const db = (await import('@/lib/prisma')).prisma;

  const action = await db.action.update({
    where: { id },
    data: { status: 'done', completedAt: new Date() },
  });

  if (result) {
    await db.interaction.create({
      data: {
        contactId: action.contactId,
        summary: result,
        channel: '结果',
        actionId: id,
        occurredAt: new Date(),
      },
    });
  }

  revalidatePath(`/actions/${id}`);
  redirect(`/actions/${id}`);
}

export default async function ActionDetail({
  params,
}: {
  params: { id: string };
}) {
  let a;
  try {
    a = await ActionService.get(params.id);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {a.status} · P{a.priority}
            {a.dueAt && ` · ${a.dueAt.toLocaleString('zh-CN')}`}
          </p>
        </div>
        <ConfirmDeleteForm action={deleteAction.bind(null, a.id)}>
          <button className="btn-danger" aria-label="删除">删除</button>
        </ConfirmDeleteForm>
      </div>

      <div className="mt-4">
        <TransitionAction id={a.id} currentStatus={a.status as ActionStatus} />
      </div>

      {a.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm">{a.description}</p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-2 text-sm">
        {a.category && <div><dt className="text-gray-500">分类</dt><dd>{a.category}</dd></div>}
        {a.contact && (
          <div>
            <dt className="text-gray-500">我答应</dt>
            <dd><Link className="text-accent" href={`/contacts/${a.contact.id}`}>{a.contact.name}</Link></dd>
          </div>
        )}
        {a.event && (
          <div>
            <dt className="text-gray-500">关联事件</dt>
            <dd><Link className="text-accent" href={`/events/${a.event.id}`}>{a.event.title}</Link></dd>
          </div>
        )}
        {a.completedAt && (
          <div>
            <dt className="text-gray-500">完成时间</dt>
            <dd>{a.completedAt.toLocaleString('zh-CN')}</dd>
          </div>
        )}
      </dl>

      {a.status !== 'done' && (
        <>
          <div className="mt-6">
            <Link
              href={`/events/new?title=${encodeURIComponent(a.title)}&contactId=${a.contactId ?? ''}`}
              className="btn-secondary"
            >
              安排时间
            </Link>
          </div>
          <CompleteActionForm actionId={a.id} onComplete={completeAction} />
        </>
      )}
    </main>
  );
}
