// Birthday feature has been removed; kept as a no-op so cron + tests keep working.
import { prisma } from '@/lib/prisma';

export const BirthdayService = {
  upcoming(_contacts: unknown[], _now: Date, _windowMs: number): { id: string; name: string; when: Date }[] {
    return [];
  },

  async upcomingForOwner(_ownerId: string) {
    return [] as { id: string; name: string; when: Date }[];
  },

  async ensureBirthdayReminders(_ownerId: string = '') {
    return 0;
  },
};

