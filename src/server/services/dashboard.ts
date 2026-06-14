import { prisma } from '@/lib/prisma';
import { InboxService } from './inbox';
import { BirthdayService } from './birthday';

export const DashboardService = {
  async snapshot() {
    const [contacts, activeNeeds, upcomingEvents, unreadInbox, allContacts] =
      await Promise.all([
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
        InboxService.unreadCount(),
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
      ]);

    const upcomingBirthdays = BirthdayService.upcoming(
      allContacts,
      new Date(),
      60 * 24 * 60 * 60 * 1000,
    ).slice(0, 5);

    return {
      contacts,
      activeNeeds,
      unreadInbox,
      upcomingBirthdays,
      upcomingEvents,
    };
  },
};
