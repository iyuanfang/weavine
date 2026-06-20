import { ContactService } from '@/server/services/contact';
import { EventForm } from '@/components/event-form';
import { createEventAction } from '@/app/calendar/actions';
import { getCurrentUser } from '@/lib/auth/session';

export default async function NewEvent({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const { id: ownerId } = await getCurrentUser();
  const contacts = await ContactService.listLight(ownerId);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">新建日程</h1>
      <EventForm
        action={createEventAction}
        contacts={contacts}
        defaultStart={searchParams.date}
      />
    </main>
  );
}
