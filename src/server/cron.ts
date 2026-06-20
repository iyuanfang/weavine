import cron from 'node-cron';
import webpush from 'web-push';
import { prisma } from '@/lib/prisma';
import { ReminderService } from './services/reminder';
import { BirthdayService } from './services/birthday';
import { contactMaintenanceReminderDue } from '@/lib/relationship';

declare global {
  var __prmCronStarted: boolean | undefined;
}

export function startCron() {
  if (globalThis.__prmCronStarted) return;
  globalThis.__prmCronStarted = true;

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost';
  if (pub && priv) {
    webpush.setVapidDetails(sub, pub, priv);
  }

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

  cron.schedule('* * * * *', async () => {
    try {
      const due = await ReminderService.dueReminders(null);
      for (const r of due) {
        let title: string;
        let body: string;
        let link: string;
        if (r.event) {
          title = r.event.title;
          body = `${r.event.startAt.toLocaleString('zh-CN')}${r.event.location ? ' · ' + r.event.location : ''}`;
          link = `/events/${r.event.id}`;
        } else if (r.kind === 'stale' && r.contact) {
          title = `该联系 ${r.contact.name} 了`;
          const days = r.contact.lastContactedAt
            ? Math.floor((Date.now() - r.contact.lastContactedAt.getTime()) / 86400_000)
            : 0;
          body = `已 ${days} 天未联系`;
          link = `/contacts/${r.contact.id}`;
        } else if (r.contact) {
          title = `${r.contact.name} 生日提醒`;
          body = `${r.contact.name} 的生日就在今天！`;
          link = `/contacts/${r.contact.id}`;
        } else {
          title = 'PRM 提醒';
          body = '';
          link = '/';
        }

        await ReminderService.markDispatched(r.id, r.ownerId);

        if (pub && priv) {
          const subs = await prisma.pushSubscription.findMany({
            where: { ownerId: r.ownerId },
            select: { endpoint: true, p256dh: true, auth: true },
          });
          for (const s of subs) {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                JSON.stringify({ title, body, link }),
              );
            } catch (sendErr: any) {
              if (sendErr?.statusCode === 410) {
                await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('reminder cron error', e);
    }
  });

  console.log('cron: started');
}
