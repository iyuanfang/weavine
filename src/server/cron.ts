import cron from 'node-cron';
import webpush from 'web-push';
import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
import { ReminderService } from './services/reminder';
import { BirthdayService } from './services/birthday';

let started = false;

export function startCron() {
  if (started) return;
  started = true;

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost';
  if (pub && priv) {
    webpush.setVapidDetails(sub, pub, priv);
  }

  // Birthday reminders — once a day at 00:05
  cron.schedule('5 0 * * *', async () => {
    try {
      const created = await BirthdayService.ensureBirthdayReminders();
      if (created > 0) console.log(`cron: created ${created} birthday reminders`);
    } catch (e) {
      console.error('birthday cron error', e);
    }
  });

  // Dispatch due reminders — every minute
  cron.schedule('* * * * *', async () => {
    try {
      const due = await ReminderService.dueReminders();
      for (const r of due) {
        const title =
          r.event?.title ?? (r.contact ? `${r.contact.name} 生日提醒` : 'PRM 提醒');
        const body = r.event
          ? `${r.event.startAt.toLocaleString('zh-CN')}${r.event.location ? ' · ' + r.event.location : ''}`
          : r.contact
            ? `${r.contact.name} 的生日就在今天！`
            : '提醒';
        const link = r.event
          ? `/events/${r.event.id}`
          : r.contact
            ? `/contacts/${r.contact.id}`
            : '/';

        // In-app notification
        await prisma.inboxItem.create({
          data: { kind: 'reminder_due', title, body, link },
        });

        // Web push
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

        await ReminderService.markDispatched(r.id);
      }
    } catch (e) {
      console.error('reminder cron error', e);
    }
  });

  console.log('cron: started');
}
