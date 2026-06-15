import cron from 'node-cron';
import webpush from 'web-push';
import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
import { ReminderService } from './services/reminder';
import { BirthdayService } from './services/birthday';
import { readSettings } from '@/app/settings/actions';

declare global {
  // eslint-disable-next-line no-var
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

  cron.schedule('5 0 * * *', async () => {
    try {
      const created = await BirthdayService.ensureBirthdayReminders();
      if (created > 0) console.log(`cron: created ${created} birthday reminders`);
    } catch (e) {
      console.error('birthday cron error', e);
    }
  });

  cron.schedule('0 9 * * *', async () => {
    try {
      const settings = await readSettings();
      const firstThreshold = settings.staleDays[0] ?? 90;
      const cutoff = new Date(Date.now() - firstThreshold * 86400_000);
      const candidates = await prisma.contact.findMany({
        where: {
          OR: [
            { lastContactedAt: { lt: cutoff } },
            {
              AND: [
                { lastContactedAt: null },
                { createdAt: { lt: cutoff } },
              ],
            },
          ],
        },
        select: { id: true, name: true, lastContactedAt: true },
        take: 50,
      });

      const tomorrow9am = new Date();
      tomorrow9am.setDate(tomorrow9am.getDate() + 1);
      tomorrow9am.setHours(9, 0, 0, 0);

      let created = 0;
      for (const c of candidates) {
        const existing = await prisma.reminder.findFirst({
          where: {
            contactId: c.id,
            kind: 'stale',
            triggerAt: { gte: new Date() },
          },
        });
        if (existing) continue;
        const days = c.lastContactedAt
          ? Math.floor((Date.now() - c.lastContactedAt.getTime()) / 86400_000)
          : firstThreshold;
        await prisma.reminder.create({
          data: {
            contactId: c.id,
            kind: 'stale',
            triggerAt: tomorrow9am,
          },
        });
        await prisma.inboxItem.create({
          data: {
            kind: 'reminder_due',
            title: `该联系 ${c.name} 了`,
            body: `已 ${days} 天未联系`,
            link: `/contacts/${c.id}`,
          },
        });
        created++;
      }
      if (created > 0) console.log(`cron: created ${created} stale contact reminders`);
    } catch (e) {
      console.error('stale cron error', e);
    }
  });

  cron.schedule('* * * * *', async () => {
    try {
      const due = await ReminderService.dueReminders();
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

        // Atomic: create inbox item + mark dispatched. If either fails, neither commits.
        try {
          await prisma.$transaction([
            prisma.inboxItem.create({
              data: { kind: 'reminder_due', title, body, link },
            }),
            prisma.reminder.update({
              where: { id: r.id },
              data: { dispatched: true },
            }),
          ]);
        } catch (dispatchErr) {
          console.error('reminder dispatch error', dispatchErr);
          continue;
        }

        if (pub && priv) {
          let pushDb: Database.Database | null = null;
          try {
            const url = (process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(/^file:/, '');
            pushDb = new Database(url);
            const subs = pushDb
              .prepare('SELECT endpoint, p256dh, auth FROM push_subscription')
              .all() as { endpoint: string; p256dh: string; auth: string }[];
            for (const s of subs) {
              try {
                await webpush.sendNotification(
                  { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                  JSON.stringify({ title, body, link }),
                );
              } catch (sendErr: any) {
                if (sendErr?.statusCode === 410) {
                  pushDb
                    .prepare('DELETE FROM push_subscription WHERE endpoint = ?')
                    .run(s.endpoint);
                }
              }
            }
          } catch (dbErr) {
            console.error('push db error', dbErr);
          } finally {
            pushDb?.close();
          }
        }
      }
    } catch (e) {
      console.error('reminder cron error', e);
    }
  });

  console.log('cron: started');
}
