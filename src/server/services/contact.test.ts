import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { testDb, closeTestDb } from './_db';
import { ContactService } from './contact';

let db: PrismaClient;

beforeAll(async () => {
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('ContactService', () => {
  it('creates and lists contacts', async () => {
    const c = await ContactService.create({ name: '张三' }, db);
    expect(c.id).toBeTruthy();
    const all = await ContactService.list({}, db);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('张三');
  });

  it('filters by tag', async () => {
    const tag = await db.tag.create({ data: { name: '朋友' } });
    const a = await ContactService.create({ name: 'A' }, db);
    const b = await ContactService.create({ name: 'B' }, db);
    await db.contactTag.create({ data: { contactId: a.id, tagId: tag.id } });
    const r = await ContactService.list({ tagId: tag.id }, db);
    expect(r.map((c) => c.name)).toEqual(['A']);
  });

  it('updates fields and updatedAt', async () => {
    const c = await ContactService.create({ name: 'A' }, db);
    const u = await ContactService.update(c.id, { company: 'X' }, db);
    expect(u.company).toBe('X');
  });

  it('throws NotFoundError on missing', async () => {
    await expect(ContactService.get('nope', db)).rejects.toThrow(/不存在/);
  });

  it('enforces birthday month/day range', async () => {
    await expect(
      ContactService.create({ name: 'A', birthdayMonth: 13 }, db)
    ).rejects.toThrow();
    await expect(
      ContactService.create({ name: 'A', birthdayDay: 0 }, db)
    ).rejects.toThrow();
  });
});
