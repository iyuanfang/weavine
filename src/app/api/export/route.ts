import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { id: ownerId } = await getCurrentUser();

  const [contacts, tags, events, interactions, actions, reminders] = await Promise.all([
    prisma.contact.findMany({
      where: { ownerId },
      include: { tags: { include: { tag: true } } },
    }),
    prisma.tag.findMany({ where: { ownerId } }),
    prisma.event.findMany({
      where: { ownerId },
      include: { contact: { select: { id: true, name: true } } },
    }),
    prisma.interaction.findMany({
      where: { ownerId },
      include: { contact: { select: { id: true, name: true } } },
    }),
    prisma.action.findMany({
      where: { ownerId },
      include: { contact: { select: { id: true, name: true } } },
    }),
    prisma.reminder.findMany({ where: { ownerId } }),
  ]);

  const settings = await prisma.setting.findMany({ where: { ownerId } });
  const settingsObj = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const payload = {
    exportedAt: new Date().toISOString(),
    counts: {
      contacts: contacts.length,
      tags: tags.length,
      events: events.length,
      interactions: interactions.length,
      actions: actions.length,
      reminders: reminders.length,
    },
    settings: settingsObj,
    contacts,
    tags,
    events,
    interactions,
    actions,
    reminders,
  };

  const filename = `prm-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
