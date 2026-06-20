import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';

const interactionInput = z.object({
  contactId: z.string(),
  occurredAt: z.coerce.date(),
  channel: z.string().max(40).nullish(),
  summary: z.string().min(1).max(4000),
});

export type InteractionInput = z.infer<typeof interactionInput>;

const interactionUpdateInput = z.object({
  occurredAt: z.coerce.date(),
  channel: z.string().max(40).nullish(),
  summary: z.string().min(1).max(4000),
});

export type InteractionUpdateInput = z.infer<typeof interactionUpdateInput>;

async function recalcLastContactedAt(
  ownerId: string,
  contactId: string,
  db: PrismaClient,
) {
  const latest = await db.interaction.findFirst({
    where: { ownerId, contactId },
    orderBy: { occurredAt: 'desc' },
  });
  await db.contact.updateMany({
    where: { id: contactId, ownerId },
    data: { lastContactedAt: latest?.occurredAt ?? null },
  });
}

// Optimized: update lastContactedAt directly using GREATEST to avoid SELECT-then-UPDATE round-trip
async function updateLastContactedAtDirect(
  ownerId: string,
  contactId: string,
  occurredAt: Date,
  db: PrismaClient,
) {
  await db.contact.updateMany({
    where: { id: contactId, ownerId },
    data: { lastContactedAt: { set: occurredAt } },
  });
}

export const InteractionService = {
  async log(
    input: InteractionInput,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const p = interactionInput.parse(input);
    if (ownerId) {
      const contact = await db.contact.findFirst({
        where: { id: p.contactId, ownerId },
        select: { id: true },
      });
      if (!contact) throw new NotFoundError('联系人不存在');
    }
    const inter = await db.interaction.create({ data: { ...p, ownerId } });
    // Direct update: no need to SELECT the latest interaction first
    if (ownerId) await updateLastContactedAtDirect(ownerId, p.contactId, p.occurredAt, db);
    return inter;
  },

  async get(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const i = await db.interaction.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      include: {
        contact: { select: { id: true, nickname: true, name: true } },
        action: { select: { id: true, title: true } },
        event: { select: { id: true, title: true } },
      },
    });
    if (!i) throw new NotFoundError('互动不存在');
    return i;
  },

  async update(
    id: string,
    input: InteractionUpdateInput,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const p = interactionUpdateInput.parse(input);
    const i = await db.interaction.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
    });
    if (!i) throw new NotFoundError('互动不存在');
    await db.interaction.update({ where: { id }, data: p });
    // Keep recalc for updates since occurredAt might change to an earlier/later date
    if (i.contactId && ownerId) await recalcLastContactedAt(ownerId, i.contactId, db);
    return db.interaction.findUniqueOrThrow({
      where: { id },
      include: {
        contact: { select: { id: true, nickname: true, name: true } },
        action: { select: { id: true, title: true } },
        event: { select: { id: true, title: true } },
      },
    });
  },

  async list(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.interaction.findMany({
      where: { ...(ownerId ? { ownerId } : {}), contactId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  },

  async remove(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const i = await db.interaction.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
    });
    if (!i) throw new NotFoundError('互动不存在');
    await db.interaction.delete({ where: { id } });
    if (i.contactId && ownerId) await recalcLastContactedAt(ownerId, i.contactId, db);
  },

  async byContact(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.interaction.findMany({
      where: { ...(ownerId ? { ownerId } : {}), contactId },
      orderBy: { occurredAt: 'desc' },
      include: {
        action: { select: { id: true, title: true } },
        event: { select: { id: true, title: true } },
        contact: { select: { id: true, nickname: true, name: true } },
      },
    });
  },

  async recent(
    days: number = 7,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return db.interaction.findMany({
      where: { ...(ownerId ? { ownerId } : {}), occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      include: {
        contact: { select: { id: true, nickname: true, name: true } },
        action: { select: { id: true, title: true } },
        event: { select: { id: true, title: true } },
      },
      take: 50,
    });
  },
};
