import { z } from 'zod';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { PrismaClient, Prisma } from '@prisma/client';

export const ACTION_STATUSES = [
  'inbox',
  'open',
  'waiting',
  'done',
  'dropped',
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

const createInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  status: z.enum(ACTION_STATUSES).default('inbox'),
  priority: z.number().int().min(0).max(10).default(0),
  category: z.string().max(40).nullish(),
  dueAt: z.coerce.date().nullish(),
  contactId: z.string().nullish(),
  eventId: z.string().nullish(),
});

const updateInput = createInput.partial().extend({
  completedAt: z.coerce.date().nullish(),
});

export const ActionService = {
  STATUSES: ACTION_STATUSES,

  async create(input: z.infer<typeof createInput>, db: PrismaClient = defaultPrisma) {
    const p = createInput.parse(input);
    return db.action.create({ data: p });
  },

  async get(id: string, db: PrismaClient = defaultPrisma) {
    const a = await db.action.findUnique({
      where: { id },
      include: { contact: true, event: true },
    });
    if (!a) throw new NotFoundError('Action 不存在');
    return a;
  },

  async update(
    id: string,
    input: z.infer<typeof updateInput>,
    db: PrismaClient = defaultPrisma,
  ) {
    const p = updateInput.parse(input);
    const data: Record<string, unknown> = { ...p };
    if (p.status === 'done' && !p.completedAt) {
      data.completedAt = new Date();
    } else if (p.status && p.status !== 'done') {
      data.completedAt = null;
    }
    try {
      return await db.action.update({ where: { id }, data });
    } catch (e) {
      console.error('[ActionService] update:', e);
      throw new NotFoundError('Action 不存在');
    }
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    try {
      await db.action.delete({ where: { id } });
    } catch (e) {
      console.error('[ActionService] remove:', e);
      throw new NotFoundError('Action 不存在');
    }
  },

  async transition(
    id: string,
    to: ActionStatus,
    db: PrismaClient = defaultPrisma,
  ) {
    if (!ACTION_STATUSES.includes(to)) throw new ValidationError('非法状态');
    const data: Record<string, unknown> = { status: to };
    if (to === 'done') data.completedAt = new Date();
    else data.completedAt = null;
    try {
      return await db.action.update({ where: { id }, data });
    } catch (e) {
      console.error('[ActionService] transition:', e);
      throw new NotFoundError('Action 不存在');
    }
  },

  async list(filter: { status?: ActionStatus } = {}, db: PrismaClient = defaultPrisma) {
    return db.action.findMany({
      where: filter.status ? { status: filter.status } : undefined,
      include: { contact: true, event: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
  },

  async byContact(contactId: string, db: PrismaClient = defaultPrisma) {
    return db.action.findMany({
      where: {
        contactId,
        status: { not: 'dropped' },
      },
      include: { contact: true, event: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }],
    });
  },

  async byEvent(eventId: string, db: PrismaClient = defaultPrisma) {
    return db.action.findMany({
      where: { eventId, status: { not: 'dropped' } },
      include: { contact: true, event: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });
  },

  async today(db: PrismaClient = defaultPrisma) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const sevenDaysLater = new Date(startOfToday);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [today, upcoming, waiting, needsAttention] = await Promise.all([
      db.action.findMany({
        where: {
          status: { in: ['inbox', 'open'] },
          dueAt: { gte: startOfToday, lt: endOfToday },
        },
        include: { contact: true, event: true },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      }),
      db.action.findMany({
        where: {
          status: { in: ['inbox', 'open'] },
          dueAt: { gte: endOfToday, lt: sevenDaysLater },
        },
        include: { contact: true, event: true },
        orderBy: [{ dueAt: 'asc' }],
        take: 20,
      }),
      db.action.findMany({
        where: { status: 'waiting' },
        include: { contact: true, event: true },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      }),
      db.contact.findMany({
        where: {
          OR: [
            { lastContactedAt: { lt: ninetyDaysAgo() } },
            {
              AND: [
                { lastContactedAt: null },
                { createdAt: { lt: ninetyDaysAgo() } },
              ],
            },
          ],
        },
        select: { id: true, name: true, lastContactedAt: true },
        take: 5,
        orderBy: { name: 'asc' },
      }),
    ]);

    return { today, upcoming, waiting, needsAttention };
  },

  async kanban(db: PrismaClient = defaultPrisma) {
    const all = await db.action.findMany({
      where: { status: { not: 'done' } },
      include: { contact: true, event: true },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    const groups: Record<string, typeof all> = {
      inbox: [],
      open: [],
      waiting: [],
      done: [],
      dropped: [],
    };
    for (const a of all) {
      const status = a.status as ActionStatus;
      if (groups[status]) groups[status].push(a);
    }
    const todayDone = await db.action.findMany({
      where: { status: 'done', completedAt: { gte: startOfToday() } },
      include: { contact: true, event: true },
      orderBy: { completedAt: 'desc' },
    });
    groups.done = todayDone;
    return groups;
  },
};

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function ninetyDaysAgo(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - 90);
  return d;
}
