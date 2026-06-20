import cron from 'node-cron';
import { prisma } from '@/lib/prisma';
import { BirthdayService } from './services/birthday';
import { contactMaintenanceReminderDue } from '@/lib/relationship';

declare global {
  var __prmCronStarted: boolean | undefined;
}

export function startCron() {
  if (globalThis.__prmCronStarted) return;
  globalThis.__prmCronStarted = true;

  const ownerIds = async () =>
    (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);

  cron.schedule('5 0 * * *', async () => {
    try {
      let total = 0;
      for (const ownerId of await ownerIds()) {
        total += await BirthdayService.ensureBirthdayReminders(ownerId);
      }
      if (total > 0) console.log(`cron: created ${total} birthday reminders`);
    } catch (e) {
      console.error('birthday cron error', e);
    }
  });

  cron.schedule('0 9 * * *', async () => {
    try {
      const owners = await ownerIds();
      for (const ownerId of owners) {
        const candidates = await prisma.contact.findMany({
          where: { ownerId },
          select: {
            id: true,
            nickname: true,
            name: true,
            lastContactedAt: true,
            createdAt: true,
            importance: true,
            reminderEnabled: true,
            reminderIntervalDays: true,
          },
        });
        const tomorrow9am = new Date();
        tomorrow9am.setDate(tomorrow9am.getDate() + 1);
        tomorrow9am.setHours(9, 0, 0, 0);
        const now = new Date();
        let created = 0;
        for (const c of candidates) {
          if (!contactMaintenanceReminderDue(c, now)) continue;
          const existing = await prisma.reminder.findFirst({
            where: {
              ownerId,
              contactId: c.id,
              kind: 'stale',
              triggerAt: { gte: new Date() },
            },
          });
          if (existing) continue;
          await prisma.reminder.create({
            data: {
              ownerId,
              contactId: c.id,
              kind: 'stale',
              triggerAt: tomorrow9am,
            },
          });
          created++;
        }
        if (created > 0) {
          console.log(`cron[${ownerId}]: created ${created} stale contact reminders`);
        }
      }
    } catch (e) {
      console.error('stale cron error', e);
    }
  });

  console.log('cron: started');
}
