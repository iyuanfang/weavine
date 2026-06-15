import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';

const contactInput = z.object({
  name: z.string().min(1).max(80),
  company: z.string().max(120).nullish(),
  title: z.string().max(120).nullish(),
  city: z.string().max(60).nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().max(40).nullish(),
  wechat: z.string().max(60).nullish(),
  birthdayMonth: z.number().int().min(1).max(12).nullish(),
  birthdayDay: z.number().int().min(1).max(31).nullish(),
  notes: z.string().max(8000).nullish(),
});

export type ContactInput = z.infer<typeof contactInput>;

function cleanInput(input: ContactInput): ContactInput {
  return {
    ...input,
    email: input.email || null,
    company: input.company || null,
    title: input.title || null,
    city: input.city || null,
    phone: input.phone || null,
    wechat: input.wechat || null,
    birthdayMonth: input.birthdayMonth ?? null,
    birthdayDay: input.birthdayDay ?? null,
    notes: input.notes || null,
  };
}

export const ContactService = {
  async create(input: ContactInput, db: PrismaClient = defaultPrisma) {
    const parsed = contactInput.parse(input);
    return db.contact.create({ data: cleanInput(parsed) });
  },

  async get(id: string, db: PrismaClient = defaultPrisma) {
    const c = await db.contact.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } } },
    });
    if (!c) throw new NotFoundError('联系人不存在');
    return c;
  },

  async list(
    filter: { tagId?: string; q?: string },
    db: PrismaClient = defaultPrisma
  ) {
    return db.contact.findMany({
      where: {
        ...(filter.tagId
          ? { tags: { some: { tagId: filter.tagId } } }
          : {}),
        ...(filter.q
          ? {
              OR: [
                { name: { contains: filter.q } },
                { company: { contains: filter.q } },
                { city: { contains: filter.q } },
              ],
            }
          : {}),
      },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    });
  },

  async update(
    id: string,
    input: Partial<ContactInput>,
    db: PrismaClient = defaultPrisma
  ) {
    const parsed = contactInput.partial().parse(input);
    const data: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) {
      data[key] = (val === '' || val === undefined) ? null : val;
    }
    try {
      return await db.contact.update({ where: { id }, data: data as Prisma.ContactUpdateInput });
    } catch (e) {
      console.error('[ContactService] update:', e);
      throw new NotFoundError('联系人不存在');
    }
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    try {
      await db.contact.delete({ where: { id } });
    } catch (e) {
      console.error('[ContactService] remove:', e);
      throw new NotFoundError('联系人不存在');
    }
  },
};
