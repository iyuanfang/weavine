import { prisma as defaultPrisma } from '@/lib/prisma';
import type { PrismaClient } from '@prisma/client';

export interface ReminderItem {
  key: string;
  kind: string;
  title: string;
  description: string;
  href: string | null;
  triggerAt: Date;
  contact: { id: string; nickname: string | null; name: string | null } | null;
  event: { id: string; title: string; startAt: Date | null } | null;
}

export const ReminderService = {
  async listGrouped(
    ownerId: string,
    now: Date = new Date(),
    db: PrismaClient = defaultPrisma,
  ): Promise<ReminderItem[]> {
    const [overdueActions, upcomingEvents, contactsDue] = await Promise.all([
      db.action.findMany({
        where: {
          ownerId,
          status: { in: ['inbox', 'open', 'waiting'] },
          dueAt: { lt: now },
        },
        orderBy: { dueAt: 'asc' },
        take: 20,
        select: {
          id: true,
          title: true,
          dueAt: true,
          contact: { select: { id: true, nickname: true, name: true } },
        },
      }),
      db.event.findMany({
        where: {
          ownerId,
          startAt: {
            gte: now,
            lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3),
          },
        },
        orderBy: { startAt: 'asc' },
        take: 20,
        select: {
          id: true,
          title: true,
          startAt: true,
          type: true,
          contact: { select: { id: true, nickname: true, name: true } },
        },
      }),
      db.contact.findMany({
        where: {
          ownerId,
          reminderEnabled: true,
          reminderIntervalDays: { not: null },
          lastContactedAt: {
            lt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          },
        },
        select: {
          id: true,
          nickname: true,
          name: true,
          lastContactedAt: true,
          reminderIntervalDays: true,
        },
        take: 20,
      }),
    ]);

    const overdueContacts = contactsDue.filter((c) => {
      if (!c.lastContactedAt || !c.reminderIntervalDays) return false;
      const cutoff = new Date(now.getTime() - c.reminderIntervalDays * 24 * 60 * 60 * 1000);
      return c.lastContactedAt < cutoff;
    });

    const allItems: ReminderItem[] = [];

    for (const a of overdueActions) {
      allItems.push({
        key: `action_overdue:${a.id}`,
        kind: 'action_overdue',
        title: a.title,
        description: a.dueAt ? `截止 ${a.dueAt.toLocaleDateString('zh-CN')} 已过期` : '已过期',
        href: `/actions/${a.id}`,
        triggerAt: a.dueAt ?? now,
        contact: a.contact,
        event: null,
      });
    }

    for (const e of upcomingEvents) {
      allItems.push({
        key: `event_upcoming:${e.id}`,
        kind: 'event_upcoming',
        title: e.title,
        description: `${new Date(e.startAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${e.type}`,
        href: `/events/${e.id}`,
        triggerAt: e.startAt,
        contact: e.contact,
        event: { id: e.id, title: e.title, startAt: e.startAt },
      });
    }

    for (const c of overdueContacts) {
      const daysSince = c.lastContactedAt
        ? Math.floor((now.getTime() - new Date(c.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      allItems.push({
        key: `contact_reminder:${c.id}`,
        kind: 'contact_reminder',
        title: c.nickname ?? c.name ?? '联系人',
        description: `已 ${daysSince} 天未联系（每 ${c.reminderIntervalDays} 天提醒一次）`,
        href: `/contacts/${c.id}`,
        triggerAt: now,
        contact: { id: c.id, nickname: c.nickname, name: c.name },
        event: null,
      });
    }

    allItems.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());

    return allItems;
  },
};