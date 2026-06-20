import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { testDb, closeTestDb } from './_db';
import { TagService } from './tag';

let db: PrismaClient;

beforeAll(() => {
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('TagService', () => {
  it('creates and lists tags', async () => {
    await TagService.create({ name: '同事', color: '#888888' }, db);
    const t = await TagService.list('user-1', db);
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('同事');
  });

  it('rejects duplicate name', async () => {
    await TagService.create({ name: '唯一' }, db);
    await expect(TagService.create({ name: '唯一' }, db)).rejects.toThrow();
  });

  it('attaches and detaches', async () => {
    const t = await TagService.create({ name: 'A' }, db);
    const c = await db.contact.create({ data: { name: 'X' } });

    await TagService.attach(c.id, t.id, db);
    const forC = await TagService.forContact(c.id, db);
    expect(forC).toHaveLength(1);

    await TagService.detach(c.id, t.id, db);
    const after = await TagService.forContact(c.id, db);
    expect(after).toHaveLength(0);
  });
});
