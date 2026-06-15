import { prisma } from '@/lib/prisma';
import { BirthdayService } from './birthday';
import { relationshipStrength } from '@/lib/relationship';
import { readSettings } from '@/app/settings/actions';

export const DashboardService = {
  async snapshot() {
    const [
      contacts,
      activeNeeds,
      upcomingEvents,
      allContacts,
      staleContactsRaw,
      settings,
    ] = await Promise.all([
      prisma.contact.count(),
      prisma.need.count({
        where: { status: { in: ['open', 'matched', 'in_progress'] } },
      }),
      prisma.event.findMany({
        where: { startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 5,
        include: {
          attendees: { include: { contact: true } },
        },
      }),
      prisma.contact.findMany({
        where: {
          birthdayMonth: { not: null },
          birthdayDay: { not: null },
        },
        select: {
          id: true,
          name: true,
          birthdayMonth: true,
          birthdayDay: true,
        },
      }),
      prisma.contact.findMany({
        orderBy: { lastContactedAt: 'asc' },
        take: 50,
        select: { id: true, name: true, lastContactedAt: true },
      }),
      readSettings(),
    ]);

    const upcomingBirthdays = BirthdayService.upcoming(
      allContacts,
      new Date(),
      60 * 24 * 60 * 60 * 1000,
    ).slice(0, 5);

    const now = new Date();
    const needsAttention = staleContactsRaw
      .map((c) => ({
        ...c,
        info: relationshipStrength(c.lastContactedAt, now, settings.staleDays),
      }))
      .filter((c) => c.info.level === 'stale' || c.info.level === 'cold')
      .sort((a, b) => (b.info.days ?? 0) - (a.info.days ?? 0))
      .slice(0, 5);

    return {
      contacts,
      activeNeeds,
      upcomingBirthdays,
      upcomingEvents,
      needsAttention,
    };
  },
};
