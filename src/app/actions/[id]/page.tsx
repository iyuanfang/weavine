import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionService } from '@/server/services/action';
import type { ActionStatus } from '@/server/services/action';
import { TransitionAction } from '@/app/today/transition-action';
import { deleteAction } from '@/app/actions/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';

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
          <button className="btn-danger">删除</button>
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
        {a.waitingOn && (
          <div>
            <dt className="text-gray-500">在等</dt>
            <dd><Link className="text-accent" href={`/contacts/${a.waitingOn.id}`}>{a.waitingOn.name}</Link></dd>
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
    </main>
  );
}
