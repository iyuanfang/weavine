import { z } from 'zod';
import { cache } from 'react';
import type { PrismaClient, Tag } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';

const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().max(40).nullish(),
});

export type TagInput = z.infer<typeof tagInput>;

type TagWithCount = Tag & { _count: { contacts: number } };

// Cache tag list across the same request (used by contacts page, contact detail page, etc.)
// In test environments, React.cache may not be available, so fall back to uncached
let cachedTagList: (ownerId: string, db?: PrismaClient) => Promise<TagWithCount[]>;
try {
  cachedTagList = cache(async (ownerId: string, db: PrismaClient = defaultPrisma) => {
    return db.tag.findMany({
      where: { ...(ownerId ? { ownerId } : {}) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
  });
} catch {
  cachedTagList = (ownerId: string, db: PrismaClient = defaultPrisma) =>
    db.tag.findMany({
      where: { ...(ownerId ? { ownerId } : {}) },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
}

export const TagService = {
  async create(
    input: TagInput,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const parsed = tagInput.parse(input);
    return db.tag.create({
      data: { ownerId, name: parsed.name, color: parsed.color ?? null },
    });
  },

  async list(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    // Use cached version for deduplication within the same request
    return cachedTagList(ownerId, db);
  },

  async rename(
    id: string,
    name: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.tag.updateMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      data: { name },
    });
  },

  async remove(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    await db.tag.deleteMany({
      where: { id, ...(ownerId ? { ownerId } : {}) },
    });
  },

  async attach(
    contactId: string,
    tagId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    await db.contactTag
      .upsert({
        where: { contactId_tagId: { contactId, tagId } },
        create: { ownerId, contactId, tagId },
        update: {},
      })
      .catch((e) => { console.error('TagService.attach failed:', e); });
  },

  async detach(
    contactId: string,
    tagId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    await db.contactTag
      .delete({ where: { contactId_tagId: { contactId, tagId } } })
      .catch((e) => { console.error('TagService.detach failed:', e); });
  },

  async forContact(
    contactId: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.contactTag.findMany({
      where: { ...(ownerId ? { ownerId } : {}), contactId },
      include: { tag: true },
    });
  },
};
