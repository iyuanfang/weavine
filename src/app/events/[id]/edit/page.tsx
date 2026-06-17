import { notFound } from 'next/navigation';
import { EventService } from '@/server/services/event';
import { ContactService } from '@/server/services/contact';
import { EventForm } from '@/components/event-form';
import { updateEventAction, deleteEventAction } from '@/app/calendar/actions';

export default async function EditEvent({
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

  const contacts = (await ContactService.list({})).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">编辑：{e.title}</h1>
      <EventForm
        action={updateEventAction.bind(null, e.id)}
        contacts={contacts}
        initial={{
          title: e.title,
          type: e.type,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt?.toISOString() ?? null,
          location: e.location,
          notes: e.notes,
          attendees: e.attendees.map((a) => ({ contactId: a.contactId })),
        }}
      />
      <form action={deleteEventAction.bind(null, e.id)} className="mt-6">
        <button className="btn-danger" aria-label="删除">删除</button>
      </form>
    </main>
  );
}
