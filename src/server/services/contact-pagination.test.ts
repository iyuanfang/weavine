import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { ContactService, CONTACT_PAGE_SIZE, type ContactListPageDb } from './contact';

const now = new Date('2026-06-20T00:00:00.000Z');

function contact(id: string, nickname: string) {
  return {
    id,
    ownerId: 'user-1',
    nickname,
    name: null,
    company: null,
    title: null,
    city: null,
    email: null,
    phone: null,
    wechat: null,
    notes: null,
    lastContactedAt: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
  };
}

describe('ContactService.listPage', () => {
  it('uses +1 take to detect next page, no separate count query', async () => {
    const count = vi.fn<[Prisma.ContactCountArgs], Promise<number>>();
    const findMany = vi
      .fn<[Prisma.ContactFindManyArgs], Promise<ReturnType<typeof contact>[]>>()
      .mockResolvedValue([
        contact('c31', '联系人31'),
      ]);
    const db: ContactListPageDb = { contact: { count, findMany } };

    const result = await ContactService.listPage(
      { page: 3, q: '张', tagId: 'tag-1', ownerId: 'user-1' },
      db,
    );

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(CONTACT_PAGE_SIZE);
    expect(count).not.toHaveBeenCalled();
    expect(result.items.map((c) => c.id)).toEqual(['c31']);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 60,
      take: CONTACT_PAGE_SIZE + 1,
    }));
  });

  it('normalizes invalid pages and keeps totalPages at least 1', async () => {
    const count = vi.fn<[Prisma.ContactCountArgs], Promise<number>>();
    const findMany = vi.fn<[Prisma.ContactFindManyArgs], Promise<ReturnType<typeof contact>[]>>().mockResolvedValue([]);
    const db: ContactListPageDb = { contact: { count, findMany } };

    const result = await ContactService.listPage({ page: -5, ownerId: 'user-1' }, db);

    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it('detects last page by item count', async () => {
    const count = vi.fn<[Prisma.ContactCountArgs], Promise<number>>();
    // Mock returns only 1 item — less than page size, so it's the last page
    const findMany = vi.fn<[Prisma.ContactFindManyArgs], Promise<ReturnType<typeof contact>[]>>()
      .mockResolvedValue([contact('c1', '联系人1')]);
    const db: ContactListPageDb = { contact: { count, findMany } };

    const result = await ContactService.listPage({ page: 1, ownerId: 'user-1' }, db);

    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(count).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: CONTACT_PAGE_SIZE + 1 }));
  });

  it('uses +1 take to detect next page', async () => {
    const count = vi.fn<[Prisma.ContactCountArgs], Promise<number>>();
    // Mock returns PAGE_SIZE + 1 items — there's a next page
    const manyItems = Array.from({ length: CONTACT_PAGE_SIZE + 1 }, (_, i) => contact(`c${i}`, `联系人${i}`));
    const findMany = vi.fn<[Prisma.ContactFindManyArgs], Promise<ReturnType<typeof contact>[]>>()
      .mockResolvedValue(manyItems);
    const db: ContactListPageDb = { contact: { count, findMany } };

    const result = await ContactService.listPage({ page: 1, ownerId: 'user-1' }, db);

    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(CONTACT_PAGE_SIZE);
    expect(count).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: CONTACT_PAGE_SIZE + 1 }));
  });
});
