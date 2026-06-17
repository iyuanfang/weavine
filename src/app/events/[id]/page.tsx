import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { EventService } from '@/server/services/event';
import { ActionService } from '@/server/services/action';
import { deleteEventAction } from '@/app/calendar/actions';
import { ConfirmDeleteForm } from '@/components/confirm-delete';
import { EventNotesForm } from '@/components/event-notes-form';

async function saveEventNotes(formData: FormData) {
  'use server';
  const id = formData.get('eventId') as string;
  const notes = (formData.get('notes') as string)?.trim();
  if (!notes) return;

  const db = (await import('@/lib/prisma')).prisma;
  const event = await db.event.findUnique({
    where: { id },
    include: { attendees: true },
  });
  if (!event) return;

  await db.interaction.create({
    data: {
      contactId: event.attendees[0]?.contactId ?? null,
      summary: notes,
      channel: '会议纪要',
      eventId: id,
      occurredAt: new Date(),
    },
  });

  revalidatePath(`/events/${id}`);
}

export default async function EventDetail({
  params,
}: {
  params: { id: string };
}) {
  let e;
  try {
    e = await EventService.get(params.id);
  } catch {
    notFound();
  }
  const actions = await ActionService.byEvent(params.id);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{e.title}</h1>
        <Link
          className="btn-secondary"
          href={`/events/${e.id}/edit`}
        >
          编辑
        </Link>
      </div>

      <p className="mt-2 text-sm text-gray-500">
        {e.type} · {e.startAt.toLocaleString('zh-CN')}
        {e.endAt ? ` – ${e.endAt.toLocaleString('zh-CN')}` : ''}
      </p>

      {e.location && <p className="mt-1 text-sm">📍 {e.location}</p>}

      <section className="mt-4">
        <h2 className="font-semibold">参与人</h2>
        {e.attendees.length === 0 ? (
          <p className="text-sm text-gray-500">无</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {e.attendees.map((a) => (
              <li key={a.contactId}>
                <Link
                  className="text-sm text-accent hover:underline"
                  href={`/contacts/${a.contact.id}`}
                >
                  {a.contact.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {actions.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">关联 Action ({actions.length})</h2>
          <ul className="mt-2 space-y-2">
            {actions.map((a) => (
              <li key={a.id} className="card">
                <Link className="font-medium hover:underline" href={`/actions/${a.id}`}>
                  {a.title}
                </Link>
                <div className="text-xs text-gray-500">
                  {a.status} · P{a.priority}
                  {a.dueAt && ` · 截止 ${a.dueAt.toLocaleString('zh-CN')}`}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {e.notes && (
        <section className="mt-6">
          <h2 className="font-semibold">备注</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {e.notes}
          </p>
        </section>
      )}

      <EventNotesForm eventId={e.id} onSave={saveEventNotes} />

      <ConfirmDeleteForm action={deleteEventAction.bind(null, e.id)}>
        <button className="btn-danger" aria-label="删除">删除</button>
      </ConfirmDeleteForm>
    </main>
  );
}
