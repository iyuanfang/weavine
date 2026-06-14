'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useRouter } from 'next/navigation';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
}

export function CalendarView({ events }: { events: CalendarEvent[] }) {
  const router = useRouter();
  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      locale="zh-cn"
      firstDay={1}
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      }}
      events={events}
      eventClick={(arg) => router.push(`/events/${arg.event.id}`)}
      dateClick={(arg) => router.push(`/events/new?date=${arg.dateStr}`)}
      height="auto"
    />
  );
}
