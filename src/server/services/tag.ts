import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const tagInput = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});

export const TagService = {
  async create(input: z.infer<typeof tagInput>) {
    const parsed = tagInput.parse(input);
    return prisma.tag.create({
      data: { name: parsed.name, color: parsed.color ?? null },
    });
  },

  async list() {
    return prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
  },

  async rename(id: string, name: string) {
    return prisma.tag.update({ where: { id }, data: { name } });
  },

  async remove(id: string) {
    await prisma.tag.delete({ where: { id } });
  },

  async attach(contactId: string, tagId: string) {
    await prisma.contactTag
      .upsert({
        where: { contactId_tagId: { contactId, tagId } },
        create: { contactId, tagId },
        update: {},
      })
      .catch(() => {});
  },

  async detach(contactId: string, tagId: string) {
    await prisma.contactTag
      .delete({ where: { contactId_tagId: { contactId, tagId } } })
      .catch(() => {});
  },

  async forContact(contactId: string) {
    return prisma.contactTag.findMany({
      where: { contactId },
      include: { tag: true },
    });
  },
};
