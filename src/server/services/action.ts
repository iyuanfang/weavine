import { z } from 'zod';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { ACTION_STATUSES, type ActionStatus } from '@/lib/action-status';
import type { PrismaClient, Prisma } from '@prisma/client';

export { ACTION_STATUSES };
export type { ActionStatus };

export const ACTION_PRIORITIES = [0, 1, 2] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<ActionPriority, string> = {
  0: '普通',
  1: '重要',
  2: '紧急',
};

const createInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  status: z.enum(ACTION_STATUSES).default('inbox'),
  priority: z
    .union([z.literal(0), z.literal(1), z.literal(2)])
    .default(0),
  category: z.string().max(40).nullish(),
  dueAt: z.coerce.date().nullish(),
  contactId: z.string().nullish(),
  eventId: z.string().nullish(),
});

const updateInput = createInput.partial().extend({
  completedAt: z.coerce.date().nullish(),
});

const CONTACT_EVENT_INCLUDE = {
  contact: { select: { id: true, nickname: true, name: true } },
  event: { select: { id: true, title: true, startAt: true, type: true } },
} as const;

export const ActionService = {
  STATUSES: ACTION_STATUSES,

  async create(
    input: z.infer<typeof createInput>,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const p = createInput.parse(input);
    return db.action.create({ data: { ...p, ownerId } });
  },

  async get(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const a = await db.action.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      include: {
        contact: { select: { id: true, nickname: true, name: true } },
        event: { select: { id: true, title: true, startAt: true, type: true } },
      },
    });
    if (!a) throw new NotFoundError('待办不存在');
    return a;
  },

  async update(
    id: string,
    input: z.infer<typeof updateInput>,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const p = updateInput.parse(input);
    const data: Record<string, unknown> = { ...p };
    if (p.status === 'done' && !p.completedAt) {
      data.completedAt = new Date();
    } else if (p.status && p.status !== 'done') {
      data.completedAt = null;
    }
    const result = await db.action.updateMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      data: data as Prisma.ActionUpdateManyMutationInput,
    });
    if (result.count === 0) throw new NotFoundError('待办不存在');
    return db.action.findUniqueOrThrow({
      where: { id },
      include: CONTACT_EVENT_INCLUDE,
    });
  },

  async remove(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const result = await db.action.deleteMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
    });
    if (result.count === 0) throw new NotFoundError('待办不存在');
  },

  async topSuggestions(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
    limit = 5,
  ) {
    const now = new Date();
    const overdue = await db.action.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        status: { in: ['inbox', 'open'] },
        dueAt: { lt: now },
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: limit,
    });
    if (overdue.length >= limit) return overdue;
    const remaining = limit - overdue.length;
    const seen = new Set(overdue.map((a) => a.id));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const upcoming = await db.action.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        status: { in: ['inbox', 'open'] },
        dueAt: { gte: now, lt: endOfWeek },
        id: { notIn: Array.from(seen) },
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: remaining,
    });
    return [...overdue, ...upcoming];
  },

  async transition(
    id: string,
    to: ActionStatus,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    if (!ACTION_STATUSES.includes(to)) throw new ValidationError('非法状态');
    const data: Record<string, unknown> = { status: to };
    if (to === 'done') data.completedAt = new Date();
    else data.completedAt = null;
    const result = await db.action.updateMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      data: data as Prisma.ActionUpdateManyMutationInput,
    });
    if (result.count === 0) throw new NotFoundError('待办不存在');
    return db.action.findUniqueOrThrow({
      where: { id },
      include: CONTACT_EVENT_INCLUDE,
    });
  },

  async list(
    filter: { status?: ActionStatus; ownerId?: string } = {},
    db: PrismaClient = defaultPrisma,
  ) {
    return db.action.findMany({
      where: {
        ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    });
  },

  async byContact(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.action.findMany({
      where: {
        contactId,
        ...(ownerId ? { ownerId } : {}),
        status: { not: 'dropped' },
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { priority: 'desc' }],
    });
  },

  async byEvent(
    eventId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.action.findMany({
      where: {
        eventId,
        ...(ownerId ? { ownerId } : {}),
        status: { not: 'dropped' },
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });
  },

  async today(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const sevenDaysLater = new Date(startOfToday);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    const [today, upcoming, waiting, needsAttention] = await Promise.all([
      db.action.findMany({
        where: {
          ...(ownerId ? { ownerId } : {}),
          status: { in: ['inbox', 'open'] },
          dueAt: { gte: startOfToday, lt: endOfToday },
        },
        include: CONTACT_EVENT_INCLUDE,
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      }),
      db.action.findMany({
        where: {
          ...(ownerId ? { ownerId } : {}),
          status: { in: ['inbox', 'open'] },
          dueAt: { gte: endOfToday, lt: sevenDaysLater },
        },
        include: CONTACT_EVENT_INCLUDE,
        orderBy: [{ dueAt: 'asc' }],
        take: 20,
      }),
      db.action.findMany({
        where: { ...(ownerId ? { ownerId } : {}), status: 'waiting' },
        include: CONTACT_EVENT_INCLUDE,
        orderBy: { updatedAt: 'asc' },
        take: 20,
      }),
      db.contact.findMany({
        where: {
          ...(ownerId ? { ownerId } : {}),
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
        select: { id: true, nickname: true, name: true, lastContactedAt: true },
        take: 5,
        orderBy: { name: 'asc' },
      }),
    ]);

    return { today, upcoming, waiting, needsAttention };
  },

  async kanban(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const all = await db.action.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        status: { not: 'dropped' },
        OR: [
          { status: { not: 'done' } },
          { status: 'done', completedAt: { gte: sevenDaysAgo } },
        ],
      },
      include: CONTACT_EVENT_INCLUDE,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    });
    const groups: Record<string, typeof all> = {
      inbox: [],
      open: [],
      waiting: [],
      done: [],
    };
    for (const a of all) {
      const status = a.status as ActionStatus;
      if (groups[status]) groups[status].push(a);
    }
    return groups;
  },
};

function ninetyDaysAgo(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 90);
  return d;
}
