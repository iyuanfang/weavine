import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

const tagInput = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});

export type TagInput = z.infer<typeof tagInput>;

export const TagService = {
  async create(input: TagInput, db: PrismaClient = defaultPrisma) {
    const parsed = tagInput.parse(input);
    return db.tag.create({
      data: { name: parsed.name, color: parsed.color ?? null },
    });
  },

  async list(db: PrismaClient = defaultPrisma) {
    return db.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
  },

  async rename(id: string, name: string, db: PrismaClient = defaultPrisma) {
    return db.tag.update({ where: { id }, data: { name } });
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    await db.tag.delete({ where: { id } });
  },

  async attach(contactId: string, tagId: string, db: PrismaClient = defaultPrisma) {
    await db.contactTag
      .upsert({
        where: { contactId_tagId: { contactId, tagId } },
        create: { contactId, tagId },
        update: {},
      })
      .catch(() => {});
  },

  async detach(contactId: string, tagId: string, db: PrismaClient = defaultPrisma) {
    await db.contactTag
      .delete({ where: { contactId_tagId: { contactId, tagId } } })
      .catch(() => {});
  },

  async forContact(contactId: string, db: PrismaClient = defaultPrisma) {
    return db.contactTag.findMany({
      where: { contactId },
      include: { tag: true },
    });
  },
};
