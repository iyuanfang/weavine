import { notFound } from 'next/navigation';
import { ActionService } from '@/server/services/action';
import { ContactService } from '@/server/services/contact';
import { EditActionForm } from '@/components/edit-action-form';
import { deleteAction } from '@/app/actions/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { getCurrentUser } from '@/lib/auth/session';

export default async function EditAction({
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

  const contacts = await ContactService.listLight(ownerId);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">编辑：{a.title}</h1>
      <EditActionForm
        actionId={a.id}
        contacts={contacts}
        initial={{
          title: a.title,
          description: a.description,
          status: a.status,
          priority: a.priority,
          category: a.category,
          dueAt: a.dueAt,
          contactId: a.contactId,
        }}
      />
      <div className="mt-6">
        <ConfirmDeleteForm action={deleteAction.bind(null, a.id)}>
          <button className="btn-danger" aria-label="删除">删除</button>
        </ConfirmDeleteForm>
      </div>
    </main>
  );
}