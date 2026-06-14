import { ContactService } from '@/server/services/contact';
import { EventForm } from '@/components/event-form';
import { createEventAction } from '@/app/calendar/actions';

export default async function NewEvent({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const contacts = (await ContactService.list({})).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建事件</h1>
      <EventForm
        action={createEventAction}
        contacts={contacts}
        defaultStart={searchParams.date}
      />
    </main>
  );
}
