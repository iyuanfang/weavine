import { prisma } from '@/lib/prisma';

export const InboxService = {
  async list() {
    return prisma.inboxItem.findMany({
      orderBy: [{ read: 'asc' as const }, { createdAt: 'desc' as const }],
      take: 100,
    });
  },

  async unreadCount() {
    return prisma.inboxItem.count({ where: { read: false } });
  },

  async markRead(id: string) {
    await prisma.inboxItem.update({ where: { id }, data: { read: true } });
  },

  async markAllRead() {
    await prisma.inboxItem.updateMany({
      where: { read: false },
      data: { read: true },
    });
  },

  async remove(id: string) {
    await prisma.inboxItem.delete({ where: { id } });
  },
};
