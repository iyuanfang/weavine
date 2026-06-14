import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { InteractionService } from './interaction';
import { ContactService } from './contact';

let db: ReturnType<typeof testDb>;

beforeAll(() => {
  db = testDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe('InteractionService', () => {
  it('creates and updates lastContactedAt to latest', async () => {
    const c = await ContactService.create({ name: 'A' }, db);
    expect(c.lastContactedAt).toBeNull();

    await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-01-01'), summary: '初次见面' },
      db,
    );
    const afterFirst = await db.contact.findUnique({ where: { id: c.id } });
    expect(afterFirst!.lastContactedAt?.toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );

    await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-03-15'), summary: '再次见面' },
      db,
    );
    const afterSecond = await db.contact.findUnique({ where: { id: c.id } });
    expect(afterSecond!.lastContactedAt?.toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it('lists desc by occurredAt', async () => {
    const c = await ContactService.create({ name: 'B' }, db);
    await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-01-01'), summary: 'old' },
      db,
    );
    await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-06-01'), summary: 'new' },
      db,
    );
    const all = await InteractionService.list(c.id, db);
    expect(all).toHaveLength(2);
    expect(all[0].summary).toBe('new');
    expect(all[1].summary).toBe('old');
  });

  it('remove recalculates lastContactedAt', async () => {
    const c = await ContactService.create({ name: 'C' }, db);
    const i1 = await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-05-01'), summary: 'm1' },
      db,
    );
    await InteractionService.log(
      { contactId: c.id, occurredAt: new Date('2026-06-01'), summary: 'm2' },
      db,
    );
    await InteractionService.remove(i1.id, db);
    const after = await db.contact.findUnique({ where: { id: c.id } });
    expect(after!.lastContactedAt?.toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });
});
