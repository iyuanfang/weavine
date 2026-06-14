import { prisma } from '@/lib/prisma';

type C = {
  id: string;
  name: string;
  birthdayMonth: number | null;
  birthdayDay: number | null;
};

export const BirthdayService = {
  upcoming(contacts: C[], now: Date, windowMs: number) {
    const out: { id: string; name: string; when: Date }[] = [];
    const y = now.getFullYear();
    for (const c of contacts) {
      if (!c.birthdayMonth || !c.birthdayDay) continue;
      const thisYear = new Date(y, c.birthdayMonth - 1, c.birthdayDay, 9, 0, 0);
      const next = thisYear < now
        ? new Date(y + 1, c.birthdayMonth - 1, c.birthdayDay, 9, 0, 0)
        : thisYear;
      const diff = next.getTime() - now.getTime();
      if (diff <= windowMs) out.push({ id: c.id, name: c.name, when: next });
    }
    return out.sort((a, b) => a.when.getTime() - b.when.getTime());
  },

  async ensureBirthdayReminders(now: Date = new Date()) {
    const contacts = await prisma.contact.findMany({
      where: { birthdayMonth: { not: null }, birthdayDay: { not: null } },
      select: { id: true, name: true, birthdayMonth: true, birthdayDay: true },
    });
    const upcoming = this.upcoming(contacts, now, 60 * 24 * 60 * 60 * 1000);
    let created = 0;
    for (const b of upcoming) {
      const exists = await prisma.reminder.findFirst({
        where: { contactId: b.id, kind: 'birthday', triggerAt: b.when },
      });
        if (!exists) {
          await prisma.reminder.create({
            data: {
              contactId: b.id,
              triggerAt: b.when,
              kind: 'birthday',
              dispatched: false,
              dismissed: false,
            },
          });
        created++;
      }
    }
    return created;
  },
};
