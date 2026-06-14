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
  it('creates an event with attendees', async () => {
    const e = await EventService.create(
      { title: 'Coffee', startAt: new Date('2026-07-01T10:00:00Z'), attendeeIds: [contactA.id] },
      db,
    );
    expect(e.title).toBe('Coffee');
    expect(e.attendees).toHaveLength(1);
    expect(e.attendees[0].contactId).toBe(contactA.id);
  });

  it('gets an event with populated attendees', async () => {
    const e = await EventService.create(
      { title: 'Lunch', startAt: new Date('2026-07-02T12:00:00Z'), attendeeIds: [contactA.id, contactB.id] },
      db,
    );
    const found = await EventService.get(e.id, db);
    expect(found.attendees).toHaveLength(2);
  });

  it('lists events by month', async () => {
    await EventService.create({ title: 'July', startAt: new Date('2026-07-15T10:00:00Z') }, db);
    const r = await EventService.listByMonth(2026, 7, db);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.every((e) => e.startAt.getMonth() === 6)).toBe(true); // JS 0-indexed
  });

  it('updates event and attendees diff', async () => {
    const e = await EventService.create(
      { title: 'Original', startAt: new Date('2026-08-01T10:00:00Z'), attendeeIds: [contactA.id] },
      db,
    );
    const updated = await EventService.update(e.id, { attendeeIds: [contactB.id] }, db);
    expect(updated.attendees.map((a) => a.contactId)).toEqual([contactB.id]);
  });

  it('removes event', async () => {
    const e = await EventService.create({ title: 'DeleteMe', startAt: new Date('2026-09-01T10:00:00Z') }, db);
    await EventService.remove(e.id, db);
    await expect(EventService.get(e.id, db)).rejects.toThrow('事件不存在');
  });

  it('lists events by contact', async () => {
    const e = await EventService.create(
      { title: 'ContactEvent', startAt: new Date('2026-10-01T10:00:00Z'), attendeeIds: [contactA.id] },
      db,
    );
    const r = await EventService.listByContact(contactA.id, db);
    expect(r.some((ev) => ev.id === e.id)).toBe(true);
  });
});
