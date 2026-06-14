import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

const DEFAULT_OFFSETS = [60, 1440];

export const ReminderService = {
  scheduleOffsets(
    startISO: string,
    offsetsMinutes: number[] = DEFAULT_OFFSETS,
    now: Date = new Date(),
  ) {
    const start = new Date(startISO);
    return offsetsMinutes
      .map((m) => ({ triggerAt: new Date(start.getTime() - m * 60_000) }))
      .filter((t) => t.triggerAt > now)
      .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());
  },

  async createManyForEvent(
    eventId: string,
    startAt: Date,
    offsets: number[] = DEFAULT_OFFSETS,
    db: PrismaClient = defaultPrisma,
  ) {
    const rows = this.scheduleOffsets(startAt.toISOString(), offsets);
    if (!rows.length) return [];
    await db.reminder.createMany({
      data: rows.map((r) => ({
        eventId,
        triggerAt: r.triggerAt,
        kind: 'event',
        dispatched: false,
        dismissed: false,
      })),
    });
    return rows;
  },

  async dueReminders(now: Date = new Date(), db: PrismaClient = defaultPrisma) {
    return db.reminder.findMany({
      where: {
        triggerAt: { lte: now },
        dispatched: false,
        dismissed: false,
      },
      include: { contact: true, event: true },
    });
  },

  async markDispatched(id: string, db: PrismaClient = defaultPrisma) {
    await db.reminder.update({ where: { id }, data: { dispatched: true } });
  },

  async dismiss(id: string, db: PrismaClient = defaultPrisma) {
    await db.reminder.update({ where: { id }, data: { dismissed: true } });
  },

  async list(limit = 50, db: PrismaClient = defaultPrisma) {
    return db.reminder.findMany({
      orderBy: { triggerAt: 'asc' },
      take: limit,
      include: { contact: true, event: true },
    });
  },
};
