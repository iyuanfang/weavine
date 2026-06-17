import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

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
  // 获取联系人的完整时间线（混排 Action + Event + Interaction，按时间倒序）
  static async forContact(contactId: string, db: PrismaClient = defaultPrisma): Promise<TimelineItem[]> {
    const [actions, events, interactions] = await Promise.all([
      db.action.findMany({
        where: { contactId, status: { not: 'dropped' } },
        include: { contact: true },
        orderBy: { createdAt: 'desc' },
      }),
      db.event.findMany({
        where: { attendees: { some: { contactId } } },
        include: { attendees: { include: { contact: true } } },
        orderBy: { startAt: 'desc' },
      }),
      db.interaction.findMany({
        where: { contactId },
        include: { contact: true },
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    const items: TimelineItem[] = [
      ...actions.map(a => ({
        type: 'action' as const, id: a.id, title: a.title,
        subtitle: a.status === 'done' ? '已完成' : `${statusLabel(a.status)} · P${a.priority}`,
        timestamp: a.dueAt ?? a.createdAt,
        priority: a.priority, status: a.status,
        contactName: a.contact?.name,
        contactId: a.contactId ?? undefined,
        link: `/actions/${a.id}`,
      })),
      ...events.map(e => ({
        type: 'event' as const, id: e.id, title: e.title,
        subtitle: `${e.type} · ${e.startAt.toLocaleString('zh-CN')}`,
        timestamp: e.startAt,
        contactName: e.attendees[0]?.contact.name,
        contactId: e.attendees[0]?.contactId,
        link: `/events/${e.id}`,
      })),
      ...interactions.map(i => ({
        type: 'interaction' as const, id: i.id, title: i.summary,
        subtitle: i.channel ?? '记录',
        timestamp: i.occurredAt,
        contactName: i.contact?.name,
        contactId: i.contactId ?? undefined,
        link: `#`, // Interaction detail TBD
      })),
    ];

    items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return items;
  }

  // 获取 /today 时间线（今日日程 + 待处理 Action + 近期互动）
  static async forToday(db: PrismaClient = defaultPrisma): Promise<{
    todayEvents: TimelineItem[];
    dueActions: TimelineItem[];
    recentInteractions: TimelineItem[];
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86400000);
    const sevenDaysAgo = new Date(startOfDay.getTime() - 7 * 86400000);

    const [events, actions, interactions] = await Promise.all([
      db.event.findMany({
        where: { startAt: { gte: startOfDay, lt: endOfDay } },
        include: { attendees: { include: { contact: true } } },
        orderBy: { startAt: 'asc' },
      }),
      db.action.findMany({
        where: { status: { in: ['open', 'waiting'] }, dueAt: { not: null } },
        include: { contact: true, event: true },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 20,
      }),
      db.interaction.findMany({
        where: { occurredAt: { gte: sevenDaysAgo } },
        include: { contact: true },
        orderBy: { occurredAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      todayEvents: events.map(e => ({
        type: 'event' as const, id: e.id, title: e.title,
        subtitle: `${e.startAt.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${e.location ? ` · ${e.location}` : ''}`,
        timestamp: e.startAt, link: `/events/${e.id}`,
      })),
      dueActions: actions.map(a => ({
        type: 'action' as const, id: a.id, title: a.title,
        subtitle: `P${a.priority} · 截止 ${a.dueAt!.toLocaleString('zh-CN')}${a.contact ? ` · ${a.contact.name}` : ''}`,
        timestamp: a.dueAt!, priority: a.priority, status: a.status,
        link: `/actions/${a.id}`,
      })),
      recentInteractions: interactions.map(i => ({
        type: 'interaction' as const, id: i.id, title: i.summary,
        subtitle: i.contact ? `${i.contact.name} · ${i.channel ?? '记录'}` : i.channel ?? '记录',
        timestamp: i.occurredAt, contactName: i.contact?.name,
        link: '#',
      })),
    };
  }
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'inbox': return '收件箱';
    case 'open': return '待办';
    case 'waiting': return '等待';
    case 'done': return '已完成';
    default: return s ?? '';
  }
}
