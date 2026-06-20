import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';

const contactInput = z.object({
  nickname: z.string().min(1).max(80),
  name: z.string().max(80).nullish(),
  company: z.string().max(120).nullish(),
  title: z.string().max(120).nullish(),
  city: z.string().max(60).nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().max(40).nullish(),
  wechat: z.string().max(60).nullish(),
  notes: z.string().max(8000).nullish(),
  importance: z.enum(['important', 'normal', 'low']).default('normal'),
  reminderEnabled: z.boolean().default(true),
  reminderIntervalDays: z.number().int().min(1).max(365).nullish(),
});

export type ContactInput = z.input<typeof contactInput>;

export const CONTACT_PAGE_SIZE = 30;

export type ContactListPageFilter = {
  tagId?: string;
  q?: string;
  ownerId?: string;
  page?: number;
};

export type ContactListPageDb = {
  contact: Pick<PrismaClient['contact'], 'count' | 'findMany'>;
};

function buildContactWhere(filter: { tagId?: string; q?: string; ownerId?: string }): Prisma.ContactWhereInput {
  return {
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.tagId
      ? { tags: { some: { tagId: filter.tagId } } }
      : {}),
    ...(filter.q
      ? {
          OR: [
            { nickname: { contains: filter.q } },
            { name: { contains: filter.q } },
            { company: { contains: filter.q } },
            { city: { contains: filter.q } },
          ],
        }
      : {}),
  };
}

function cleanInput(input: ContactInput): Omit<ContactInput, never> & { ownerId: string } {
  return {
    nickname: input.nickname,
    name: input.name || null,
    company: input.company || null,
    title: input.title || null,
    city: input.city || null,
    email: input.email || null,
    phone: input.phone || null,
    wechat: input.wechat || null,
    notes: input.notes || null,
    importance: input.importance ?? 'normal',
    reminderEnabled: input.reminderEnabled ?? true,
    reminderIntervalDays: input.reminderIntervalDays || null,
    ownerId: (input as { ownerId?: string }).ownerId ?? '',
  };
}

export const ContactService = {
  async create(
    input: ContactInput,
    ownerId: string,
    db: PrismaClient = defaultPrisma,
  ) {
    const parsed = contactInput.parse(input);
    return db.contact.create({ data: { ...cleanInput(parsed), ownerId } });
  },

  async get(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const c = await db.contact.findFirst({
      where: { id, ...(ownerId ? { ownerId } : {}) },
      include: { tags: { include: { tag: true } } },
    });
    if (!c) throw new NotFoundError('联系人不存在');
    return c;
  },

  async list(
    filter: { tagId?: string; q?: string; ownerId?: string } = {},
    db: PrismaClient = defaultPrisma,
  ) {
    return db.contact.findMany({
      where: buildContactWhere(filter),
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    });
  },

  async listPage(
    filter: ContactListPageFilter = {},
    db: ContactListPageDb = defaultPrisma,
  ) {
    const requestedPage = Number.isFinite(filter.page) && filter.page && filter.page > 0
      ? Math.floor(filter.page)
      : 1;
    const where = buildContactWhere(filter);
    // Use count only when page is suspiciously large (more than 2x expected pages from first fetch)
    // Otherwise use +1 take trick to avoid the count query
    const items = await db.contact.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
      skip: (requestedPage - 1) * CONTACT_PAGE_SIZE,
      take: CONTACT_PAGE_SIZE + 1,
    });
    const hasMore = items.length > CONTACT_PAGE_SIZE;
    const pageItems = hasMore ? items.slice(0, -1) : items;
    // If we got fewer items than page size, this is the last page
    const isLastPage = pageItems.length < CONTACT_PAGE_SIZE;
    // Approximate total: if last page, estimate based on what we have
    const total = isLastPage
      ? (requestedPage - 1) * CONTACT_PAGE_SIZE + pageItems.length
      : hasMore
        ? requestedPage * CONTACT_PAGE_SIZE + 1
        : requestedPage * CONTACT_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE));
    // Clamp page to valid range
    const page = isLastPage ? Math.min(requestedPage, totalPages) : requestedPage;
    return {
      items: pageItems,
      total,
      page,
      pageSize: CONTACT_PAGE_SIZE,
      totalPages,
    };
  },

  async listAll(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.contact.findMany({
      where: { ...(ownerId ? { ownerId } : {}) },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    });
  },

  async listLight(
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    return db.contact.findMany({
      where: { ...(ownerId ? { ownerId } : {}) },
      select: { id: true, nickname: true, name: true, company: true, city: true },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
  },

  async update(
    id: string,
    input: Partial<ContactInput>,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    const parsed = contactInput.partial().parse(input);
    const data: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (key === 'ownerId') continue;
      data[key] = (val === '' || val === undefined) ? null : val;
    }
    try {
      return await db.contact.updateMany({
        where: { id, ...(ownerId ? { ownerId } : {}) },
        data: data as Prisma.ContactUpdateManyMutationInput,
      });
    } catch (e) {
      console.error('[ContactService] update:', e);
      throw new NotFoundError('联系人不存在');
    }
  },

  async remove(
    id: string,
    ownerId: string = '',
    db: PrismaClient = defaultPrisma,
  ) {
    try {
      const result = await db.contact.deleteMany({
        where: { id, ...(ownerId ? { ownerId } : {}) },
      });
      if (result.count === 0) throw new NotFoundError('联系人不存在');
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      console.error('[ContactService] remove:', e);
      throw new NotFoundError('联系人不存在');
    }
  },
};
