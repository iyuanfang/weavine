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

async function recalcLastContactedAt(
  contactId: string,
  db: PrismaClient,
) {
  const latest = await db.interaction.findFirst({
    where: { contactId },
    orderBy: { occurredAt: 'desc' },
  });
  await db.contact.update({
    where: { id: contactId },
    data: { lastContactedAt: latest?.occurredAt ?? null },
  });
}

export const InteractionService = {
  async log(input: InteractionInput, db: PrismaClient = defaultPrisma) {
    const p = interactionInput.parse(input);
    const inter = await db.interaction.create({ data: p });
    await recalcLastContactedAt(p.contactId, db);
    return inter;
  },

  async list(
    contactId: string,
    db: PrismaClient = defaultPrisma,
  ) {
    return db.interaction.findMany({
      where: { contactId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    const i = await db.interaction.findUnique({ where: { id } });
    if (!i) throw new NotFoundError('互动不存在');
    await db.interaction.delete({ where: { id } });
    await recalcLastContactedAt(i.contactId, db);
  },
};
