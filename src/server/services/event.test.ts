import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { EventService } from './event';
import { ContactService } from './contact';
import { prisma } from '@/lib/prisma';

let db: ReturnType<typeof testDb>;
let contactA: { id: string };
let contactB: { id: string };

beforeAll(async () => {
  db = testDb();
  contactA = await ContactService.create({ name: 'Alice' }, db);
  contactB = await ContactService.create({ name: 'Bob' }, db);
});

afterAll(async () => {
  await closeTestDb();
});

describe('EventService', () => {
  it('creates an event with a contact', async () => {
    const e = await EventService.create(
      { title: 'Coffee', startAt: new Date('2026-07-01T10:00:00Z'), contactId: contactA.id },
      db,
    );
    expect(e.title).toBe('Coffee');
    expect(e.contactId).toBe(contactA.id);
  });

  it('gets an event with populated contact', async () => {
    const e = await EventService.create(
      { title: 'Lunch', startAt: new Date('2026-07-02T12:00:00Z'), contactId: contactA.id },
      db,
    );
    const found = await EventService.get(e.id, db);
    expect(found.contactId).toBe(contactA.id);
  });

  it('lists events by month', async () => {
    await EventService.create({ title: 'July', startAt: new Date('2026-07-15T10:00:00Z') }, db);
    const r = await EventService.listByMonth(2026, 7, db);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.every((e) => e.startAt.getMonth() === 6)).toBe(true); // JS 0-indexed
  });

  it('updates event contactId', async () => {
    const e = await EventService.create(
      { title: 'Original', startAt: new Date('2026-08-01T10:00:00Z'), contactId: contactA.id },
      db,
    );
    const updated = await EventService.update(e.id, { contactId: contactB.id }, db);
    expect(updated.contactId).toBe(contactB.id);
  });

  it('clears contactId on update', async () => {
    const e = await EventService.create(
      { title: 'WithContact', startAt: new Date('2026-08-01T10:00:00Z'), contactId: contactA.id },
      db,
    );
    const updated = await EventService.update(e.id, { contactId: null }, db);
    expect(updated.contactId).toBeNull();
  });

  it('removes event', async () => {
    const e = await EventService.create({ title: 'DeleteMe', startAt: new Date('2026-09-01T10:00:00Z') }, db);
    await EventService.remove(e.id, db);
    await expect(EventService.get(e.id, db)).rejects.toThrow('事件不存在');
  });

  it('lists events by contact', async () => {
    const e = await EventService.create(
      { title: 'ContactEvent', startAt: new Date('2026-10-01T10:00:00Z'), contactId: contactA.id },
      db,
    );
    const r = await EventService.listByContact(contactA.id, db);
    expect(r.some((ev) => ev.id === e.id)).toBe(true);
  });

  it('creates event without contact', async () => {
    const e = await EventService.create({ title: 'NoContact', startAt: new Date('2026-11-01T10:00:00Z') }, db);
    expect(e.contactId).toBeNull();
  });
});
