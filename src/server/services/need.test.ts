import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import type { PrismaClient } from '@prisma/client';
import { NeedService } from './need';
import { ContactService } from './contact';

let db: PrismaClient;

beforeAll(() => {
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('NeedService', () => {
  it('creates with default status open', async () => {
    const n = await NeedService.create(
      { title: '找前端工程师', category: '合作' },
      db,
    );
    expect(n.id).toBeTruthy();
    expect(n.status).toBe('open');
  });

  it('transitions through pipeline', async () => {
    const n = await NeedService.create(
      { title: '设计外包', category: '合作' },
      db,
    );
    const matched = await NeedService.transition(n.id, 'matched', db);
    expect(matched.status).toBe('matched');

    const inProgress = await NeedService.transition(n.id, 'in_progress', db);
    expect(inProgress.status).toBe('in_progress');

    const closed = await NeedService.transition(n.id, 'closed', db);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeTruthy();
  });

  it('assigns contact and auto-sets matched', async () => {
    const c = await ContactService.create({ name: '张三' }, db);
    const n = await NeedService.create(
      { title: '找人背书', category: '介绍' },
      db,
    );
    const updated = await NeedService.assignContact(n.id, c.id, db);
    expect(updated.contactId).toBe(c.id);
    expect(updated.status).toBe('matched');
  });

  it('groups by status in kanban', async () => {
    await NeedService.create({ title: 'A', category: '交流' }, db);
    await NeedService.create({ title: 'B', category: '合作' }, db);
    const groups = await NeedService.kanban(db);
    expect(groups.open.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects invalid status transition', async () => {
    const n = await NeedService.create(
      { title: 'X', category: '其他' },
      db,
    );
    await expect(
      NeedService.transition(n.id, 'invalid' as any, db),
    ).rejects.toThrow();
  });

  it('throws NotFoundError on missing', async () => {
    await expect(NeedService.get('fake-id', db)).rejects.toThrow('不存在');
    await expect(NeedService.remove('fake-id', db)).rejects.toThrow('不存在');
  });
});
