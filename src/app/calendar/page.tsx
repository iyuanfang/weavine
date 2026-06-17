import Link from 'next/link';
import dynamic from 'next/dynamic';
import { EventService } from '@/server/services/event';

const CalendarView = dynamic(() => import('@/components/calendar-view').then((mod) => mod.CalendarView), { ssr: false });

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { y?: string; m?: string };
}) {
  const now = new Date();
  const y = Number(searchParams.y ?? now.getFullYear());
  const m = Number(searchParams.m ?? now.getMonth() + 1);
  const list = await EventService.listByMonth(y, m);
  const events = list.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.startAt.toISOString(),
    ...(e.endAt ? { end: e.endAt.toISOString() } : {}),
  }));

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          日程 · {y}-{String(m).padStart(2, '0')}
        </h1>
        <Link
          href="/events/new"
          className="btn-primary"
        >
          新建
        </Link>
      </div>
      <CalendarView events={events} />
    </main>
  );
}
