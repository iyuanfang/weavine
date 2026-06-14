import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';

const eventInput = z.object({
  title: z.string().min(1).max(120),
  type: z.enum(['meeting', 'birthday', 'anniversary', 'reminder', 'custom']).default('meeting'),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  location: z.string().max(200).nullish(),
  notes: z.string().max(8000).nullish(),
  attendeeIds: z.array(z.string()).default([]),
});

export type EventInput = z.infer<typeof eventInput>;

export const EventService = {
  async create(input: EventInput, db: PrismaClient = defaultPrisma) {
    const p = eventInput.parse(input);
    return db.event.create({
      data: {
        title: p.title,
        type: p.type,
        startAt: p.startAt,
        endAt: p.endAt ?? null,
        location: p.location ?? null,
        notes: p.notes ?? null,
        attendees: { create: p.attendeeIds.map((id) => ({ contactId: id })) },
      },
      include: { attendees: true },
    });
  },

  async get(id: string, db: PrismaClient = defaultPrisma) {
    const e = await db.event.findUnique({
      where: { id },
      include: { attendees: { include: { contact: true } } },
    });
    if (!e) throw new NotFoundError('事件不存在');
    return e;
  },

  async update(id: string, input: Partial<EventInput>, db: PrismaClient = defaultPrisma) {
    const { attendeeIds, ...rest } = eventInput.partial().parse(input);
    if (attendeeIds !== undefined) {
      await db.eventAttendee.deleteMany({ where: { eventId: id } });
    }
    try {
      return await db.event.update({
        where: { id },
        data: {
          ...rest,
          attendees:
            attendeeIds !== undefined
              ? { create: attendeeIds.map((cid) => ({ contactId: cid })) }
              : undefined,
        },
        include: { attendees: { include: { contact: true } } },
      });
    } catch {
      throw new NotFoundError('事件不存在');
    }
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    try {
      await db.event.delete({ where: { id } });
    } catch {
      throw new NotFoundError('事件不存在');
    }
  },

  async listByMonth(year: number, month1to12: number, db: PrismaClient = defaultPrisma) {
    const start = new Date(Date.UTC(year, month1to12 - 1, 1));
    const end = new Date(Date.UTC(year, month1to12, 1));
    return db.event.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: { attendees: { include: { contact: true } } },
      orderBy: { startAt: 'asc' },
    });
  },

  async listByContact(contactId: string, db: PrismaClient = defaultPrisma) {
    return db.event.findMany({
      where: { attendees: { some: { contactId } } },
      orderBy: { startAt: 'desc' },
      take: 50,
      include: { attendees: { include: { contact: true } } },
    });
  },
};
