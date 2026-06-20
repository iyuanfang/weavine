import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ActionService } from '@/server/services/action';
import type { ActionStatus, ActionPriority } from '@/server/services/action';
import { PRIORITY_LABEL } from '@/server/services/action';
import { actionStatusLabel } from '@/lib/action-status';
import { deleteAction } from '@/app/actions/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { CompleteActionForm } from '@/components/complete-action-form';
import { InteractionService } from '@/server/services/interaction';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth/session';

async function completeAction(formData: FormData) {
  'use server';
  const { id: ownerId } = await getCurrentUser();
  const id = formData.get('actionId') as string;
  const result = (formData.get('result') as string)?.trim();

  const existing = await prisma.action.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== ownerId) return;

  const ts = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const newDescription = result
    ? existing.description
      ? `${existing.description}\n[${ts} 完成] ${result}`
      : `[${ts} 完成] ${result}`
    : existing.description;

  await prisma.action.updateMany({
    where: { id, ownerId },
    data: { status: 'done', completedAt: new Date(), description: newDescription },
  });

  if (result && existing.contactId) {
    await InteractionService.log(
      {
        contactId: existing.contactId,
        occurredAt: new Date(),
        channel: '结果',
        summary: result,
      },
      ownerId,
    );
  }

  revalidatePath(`/actions/${id}`);
  redirect(`/actions/${id}`);
}

export default async function ActionDetail({
  params,
}: {
  params: { id: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  let a;
  try {
    a = await ActionService.get(params.id, ownerId);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {actionStatusLabel(a.status as ActionStatus)} · P{a.priority} {PRIORITY_LABEL[a.priority as ActionPriority] ?? ''}
            {a.dueAt && ` · ${a.dueAt.toLocaleString('zh-CN')}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/actions/${a.id}/edit`} className="btn-secondary text-sm">编辑</Link>
          <ConfirmDeleteForm action={deleteAction.bind(null, a.id)}>
            <button className="btn-danger" aria-label="删除">删除</button>
          </ConfirmDeleteForm>
        </div>
      </div>

      {a.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm">{a.description}</p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-2 text-sm">
        {a.category && <div><dt className="text-gray-500">分类</dt><dd>{a.category}</dd></div>}
        {a.contact && (
          <div>
            <dt className="text-gray-500">我答应</dt>
            <dd><Link className="text-accent" href={`/contacts/${a.contact.id}`}>{a.contact.nickname ?? a.contact.name ?? '?'}</Link></dd>
          </div>
        )}
        {a.event && (
          <div>
            <dt className="text-gray-500">关联日程</dt>
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
          <div className="mt-6 flex gap-2">
            {a.event ? (
              <Link href={`/events/${a.event.id}`} className="btn-secondary">查看日程</Link>
            ) : (
              <Link
                href={`/events/new?title=${encodeURIComponent(a.title)}&contactId=${a.contactId ?? ''}`}
                className="btn-secondary"
              >
                安排日程
              </Link>
            )}
          </div>
          <CompleteActionForm actionId={a.id} onComplete={completeAction} />
        </>
      )}
    </main>
  );
}