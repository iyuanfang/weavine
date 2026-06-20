import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { actionStatusLabel } from '@/lib/action-status';
import { formatEventType } from '@/lib/event-type';
import { ActionService } from './action';

export type TimelineItemType = 'action' | 'event' | 'interaction';

export type TimelineItem = {
  type: TimelineItemType;
  id: string;
  title: string;
  subtitle: string;
  timestamp: Date;
  priority?: number;
  status?: string;
  contactName?: string;
  contactId?: string;
  link: string;
};

export class TimelineService {
  static async forContact(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ): Promise<TimelineItem[]> {
    const [actions, events, interactions] = await Promise.all([
      db.action.findMany({
        where: { ownerId, contactId, status: { not: 'dropped' } },
        include: { contact: true },
        orderBy: { createdAt: 'desc' },
      }),
      db.event.findMany({
        where: { ownerId, contactId },
        include: { contact: true },
        orderBy: { startAt: 'desc' },
      }),
      db.interaction.findMany({
        where: { ownerId, contactId },
        include: { contact: true },
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    const items: TimelineItem[] = [
      ...actions.map(a => ({
        type: 'action' as const, id: a.id, title: a.title,
        subtitle: a.status === 'done' ? '✅ 已完成' : `${actionStatusLabel(a.status)} · P${a.priority}`,
        timestamp: a.dueAt ?? a.createdAt,
        priority: a.priority, status: a.status,
        contactName: a.contact?.nickname ?? a.contact?.name ?? undefined,
        contactId: a.contactId ?? undefined,
        link: `/actions/${a.id}`,
      })),
      ...events.map(e => ({
        type: 'event' as const, id: e.id, title: e.title,
        subtitle: `${formatEventType(e.type)} · ${e.startAt.toLocaleString('zh-CN')}`,
        timestamp: e.startAt,
        contactName: e.contact?.nickname ?? e.contact?.name ?? undefined,
        contactId: e.contactId ?? undefined,
        link: `/events/${e.id}`,
      })),
      ...interactions.map(i => ({
        type: 'interaction' as const, id: i.id, title: i.summary,
        subtitle: i.channel ?? '互动',
        timestamp: i.occurredAt,
        contactName: i.contact?.nickname ?? i.contact?.name ?? undefined,
        contactId: i.contactId ?? undefined,
        link: `/interactions/${i.id}`,
      })),
    ];

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return items;
  }

  static async forToday(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ): Promise<{
    todayDoActions: TimelineItem[];
    upcomingEvents: TimelineItem[];
    recentInteractions: TimelineItem[];
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDayAfter = new Date(startOfDay.getTime() + 3 * 86400000);
    const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 86400000);

    const [todayDoActions, upcomingEvents, interactions] = await Promise.all([
      db.action.findMany({
        where: {
          ownerId,
          status: { in: ['inbox', 'open'] },
          dueAt: { not: null, lt: endOfDayAfter },
        },
        select: {
          id: true, title: true, priority: true, status: true, dueAt: true,
          contact: { select: { nickname: true, name: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 5,
      }),
      db.event.findMany({
        where: { ownerId, startAt: { gte: now, lt: endOfDayAfter } },
        select: {
          id: true, title: true, startAt: true, location: true, contactId: true,
          contact: { select: { nickname: true, name: true } },
        },
        orderBy: { startAt: 'asc' },
      }),
      db.interaction.findMany({
        where: { ownerId, occurredAt: { gte: sevenDaysAgo } },
        select: {
          id: true, summary: true, channel: true, occurredAt: true,
          contact: { select: { nickname: true, name: true } },
        },
        orderBy: { occurredAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      todayDoActions: todayDoActions.map(a => {
        const isOverdue = a.dueAt! < now;
        const datePart = a.dueAt!.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' });
        const timePart = a.dueAt!.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const contactPart = a.contact ? ` · ${a.contact.nickname ?? a.contact.name}` : '';
        return {
          type: 'action' as const,
          id: a.id,
          title: a.title,
          subtitle: `${isOverdue ? '已过期 · ' : '今天 '}${datePart} ${timePart}${contactPart}`,
          timestamp: a.dueAt!,
          priority: a.priority,
          status: a.status,
          link: `/actions/${a.id}`,
        };
      }),
      upcomingEvents: upcomingEvents.map(e => {
        const dayDiff = Math.round((e.startAt.getTime() - startOfDay.getTime()) / 86400000);
        const dayLabel = dayDiff === 0 ? '今天' : dayDiff === 1 ? '明天' : dayDiff === 2 ? '后天'
          : e.startAt.toLocaleString('zh-CN', { weekday: 'short' });
        const timePart = e.startAt.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const contactPart = e.contact ? ` · ${e.contact.nickname ?? e.contact.name}` : '';
        const locPart = e.location ? ` · ${e.location}` : '';
        return {
          type: 'event' as const,
          id: e.id,
          title: e.title,
          subtitle: `${dayLabel} ${timePart}${locPart}${contactPart}`,
          timestamp: e.startAt,
          contactName: e.contact?.nickname ?? e.contact?.name ?? undefined,
          link: `/events/${e.id}`,
        };
      }),
      recentInteractions: interactions.map(i => ({
        type: 'interaction' as const,
        id: i.id,
        title: i.summary,
        subtitle: i.contact
          ? `${i.contact.nickname ?? i.contact.name} · ${i.channel ?? '互动'}`
          : (i.channel ?? '互动'),
        timestamp: i.occurredAt,
        contactName: i.contact?.nickname ?? i.contact?.name ?? undefined,
        link: `/interactions/${i.id}`,
      })),
    };
  }
}

function statusLabel(s?: string): string {
  return actionStatusLabel(s);
}
