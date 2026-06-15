import { z } from 'zod';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { PrismaClient } from '@prisma/client';

const STATUS = ['open', 'matched', 'in_progress', 'closed', 'cancelled'] as const;
export type NeedStatus = (typeof STATUS)[number];
const CATEGORIES = ['交流', '合作', '咨询', '介绍', '帮忙', '其他'] as const;

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(4000).nullish(),
  category: z.enum(CATEGORIES),
  priority: z.coerce.number().int().min(0).max(10).default(0),
  contactId: z.string().nullish(),
});

const updateSchema = createSchema.partial();

export type NeedCreateInput = z.infer<typeof createSchema>;
export type NeedUpdateInput = z.infer<typeof updateSchema>;

export const NeedService = {
  CATEGORIES,
  STATUSES: STATUS,

  async create(input: NeedCreateInput, db: PrismaClient = defaultPrisma) {
    return db.need.create({ data: createSchema.parse(input) });
  },

  async get(id: string, db: PrismaClient = defaultPrisma) {
    const n = await db.need.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!n) throw new NotFoundError('需求不存在');
    return n;
  },

  async update(id: string, input: NeedUpdateInput, db: PrismaClient = defaultPrisma) {
    try {
      return await db.need.update({
        where: { id },
        data: updateSchema.parse(input),
      });
    } catch (e) {
      console.error('[NeedService] update:', e);
      throw new NotFoundError('需求不存在');
    }
  },

  async remove(id: string, db: PrismaClient = defaultPrisma) {
    try {
      await db.need.delete({ where: { id } });
    } catch (e) {
      console.error('[NeedService] remove:', e);
      throw new NotFoundError('需求不存在');
    }
  },

  async transition(
    id: string,
    to: (typeof STATUS)[number],
    db: PrismaClient = defaultPrisma,
  ) {
    if (!STATUS.includes(to)) {
      throw new ValidationError(`非法状态: ${to}`);
    }
    const data: Record<string, unknown> = { status: to };
    if (to === 'closed') data.closedAt = new Date();
    try {
      return await db.need.update({ where: { id }, data });
    } catch (e) {
      console.error('[NeedService] transition:', e);
      throw new NotFoundError('需求不存在');
    }
  },

  async assignContact(
    id: string,
    contactId: string,
    db: PrismaClient = defaultPrisma,
  ) {
    try {
      return await db.need.update({
        where: { id },
        data: { contactId, status: 'matched' },
      });
    } catch (e) {
      console.error('[NeedService] assignContact:', e);
      throw new NotFoundError('需求不存在');
    }
  },

  async kanban(db: PrismaClient = defaultPrisma) {
    const all = await db.need.findMany({
      include: { contact: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    const groups: Record<string, typeof all> = {
      open: [],
      matched: [],
      in_progress: [],
      closed: [],
      cancelled: [],
    };
    for (const n of all) {
      if (groups[n.status]) groups[n.status].push(n);
    }
    return groups;
  },

  async list(db: PrismaClient = defaultPrisma) {
    return db.need.findMany({
      include: { contact: true },
      orderBy: { createdAt: 'desc' },
    });
  },
};
