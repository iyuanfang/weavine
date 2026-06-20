import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { ReminderService } from './reminder';
import { DEFAULT_EVENT_TYPE } from '@/lib/event-type';

const eventInput = z.object({
  title: z.string().min(1).max(120),
  type: z
    .string()
    .min(1)
    .max(40)
    .default(DEFAULT_EVENT_TYPE),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  location: z.string().max(200).nullish(),
  notes: z.string().max(8000).nullish(),
  contactId: z.string().nullish(),
});

export type EventInput = z.infer<typeof eventInput>;

export const EventService = {
  async create(
    input: EventInput,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const p = eventInput.parse(input);
    const event = await db.event.create({
      data: {
        ownerId,
        title: p.title,
        type: p.type,
        startAt: p.startAt,
        endAt: p.endAt ?? null,
        location: p.location ?? null,
        notes: p.notes ?? null,
        contactId: p.contactId ?? null,
      },
    });
    await ReminderService.createManyForEvent(event.id, p.startAt, ownerId, undefined, db);
    return event;
  },

  async get(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const e = await db.event.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      include: { contact: true },
    });
    if (!e) throw new NotFoundError('事件不存在');
    return e;
  },

  async update(
    id: string,
    input: Partial<EventInput>,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const { contactId, ...rest } = eventInput.partial().parse(input);
    try {
      const data: Prisma.EventUncheckedUpdateManyInput = { ...rest };
      if (contactId !== undefined) {
        data.contactId = contactId ?? null;
      }
      const result = await db.event.updateMany({
        where: { id, ...(ownerId ? { ownerId } : {}) },
        data,
      });
      if (result.count === 0) throw new NotFoundError('事件不存在');
      const updated = await db.event.findUniqueOrThrow({
        where: { id },
        include: { contact: true },
      });
      if (rest.startAt) {
        await db.reminder.deleteMany({
          where: {
            eventId: id,
            ...(ownerId ? { ownerId } : {}),
            dispatched: false,
            dismissed: false,
          },
        });
        await ReminderService.createManyForEvent(id, rest.startAt, ownerId, undefined, db);
      }
      return updated;
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      console.error('[EventService] update:', e);
      throw new NotFoundError('事件不存在');
    }
  },

  async remove(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const result = await db.event.deleteMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
    });
    if (result.count === 0) throw new NotFoundError('事件不存在');
  },

  async listByMonth(
    year: number,
    month1to12: number,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const start = new Date(Date.UTC(year, month1to12 - 1, 1));
    const end = new Date(Date.UTC(year, month1to12, 1));
    return db.event.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        startAt: { gte: start, lt: end },
      },
      include: { contact: true },
      orderBy: { startAt: 'asc' },
    });
  },

  async listByContact(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.event.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        contactId,
      },
      orderBy: { startAt: 'desc' },
      take: 50,
      include: { contact: true },
    });
  },

  async createWithFollowup(
    input: EventInput,
    followup: { title: string; offsetMinutes: number; contactId?: string },
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const event = await this.create(input, ownerId, db);
    const dueAt = new Date(event.startAt.getTime() - followup.offsetMinutes * 60_000);
    if (dueAt > new Date()) {
      await db.action.create({
        data: {
          ownerId,
          title: followup.title,
          status: 'open',
          priority: 1,
          dueAt,
          contactId: followup.contactId ?? null,
          eventId: event.id,
        },
      });
    }
    return event;
  },
};
