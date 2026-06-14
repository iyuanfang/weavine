import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { TagService } from './tag';

beforeAll(() => {
  testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('TagService', () => {
  it('creates and lists tags', async () => {
    await TagService.create({ name: '同事', color: '#888888' });
    const t = await TagService.list();
    expect(t).toHaveLength(1);
    expect(t[0].name).toBe('同事');
  });

  it('rejects duplicate name', async () => {
    await TagService.create({ name: '唯一' });
    await expect(TagService.create({ name: '唯一' })).rejects.toThrow();
  });

  it('attaches and detaches', async () => {
    const t = await TagService.create({ name: 'A' });
    const db = testDb();
    const c = await db.contact.create({ data: { name: 'X' } });

    await TagService.attach(c.id, t.id);
    const forC = await TagService.forContact(c.id);
    expect(forC).toHaveLength(1);

    await TagService.detach(c.id, t.id);
    const after = await TagService.forContact(c.id);
    expect(after).toHaveLength(0);
  });
});
