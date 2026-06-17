import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { ActionService } from './action';
import { ContactService } from './contact';

beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });

describe('ActionService', () => {
  const db = () => testDb();

  it('creates with default status inbox', async () => {
    const a = await ActionService.create({ title: '发合同给李四' }, db());
    expect(a.status).toBe('inbox');
    expect(a.priority).toBe(0);
  });

  it('creates with dueAt and contactId', async () => {
    const c = await ContactService.create({ name: '李四' }, db());
    const due = new Date(2026, 5, 20, 14, 0, 0);
    const a = await ActionService.create({
      title: '约咖啡',
      dueAt: due,
      contactId: c.id,
    }, db());
    expect(a.contactId).toBe(c.id);
    expect(a.dueAt?.getTime()).toBe(due.getTime());
  });

  it('transitions through pipeline (inbox→open→waiting→done→open resets completedAt)', async () => {
    const a = await ActionService.create({ title: 'A' }, db());
    expect((await ActionService.transition(a.id, 'open', db())).status).toBe('open');
    expect((await ActionService.transition(a.id, 'waiting', db())).status).toBe('waiting');
    const done = await ActionService.transition(a.id, 'done', db());
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
    const reopened = await ActionService.transition(a.id, 'open', db());
    expect(reopened.completedAt).toBeNull();
  });

  it('rejects invalid status', async () => {
    const a = await ActionService.create({ title: 'A' }, db());
    await expect(ActionService.transition(a.id, 'invalid' as any, db())).rejects.toThrow();
  });

  it('byContact returns actions for the contact only (waiting uses status)', async () => {
    const a = await ContactService.create({ name: 'A' }, db());
    const b = await ContactService.create({ name: 'B' }, db());
    await ActionService.create({ title: '答应A的事', contactId: a.id }, db());
    await ActionService.create({ title: '等B的事', contactId: b.id, status: 'waiting' }, db());
    const r = await ActionService.byContact(a.id, db());
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('答应A的事');
    const r2 = await ActionService.byContact(b.id, db());
    expect(r2).toHaveLength(1);
    expect(r2[0].title).toBe('等B的事');
  });

  it('today() groups actions by due bucket', async () => {
    const today = new Date();
    today.setHours(23, 0, 0, 0);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    tomorrow.setHours(10, 0, 0, 0);
    const a1 = await ActionService.create({ title: '今天', dueAt: today, status: 'open' }, db());
    const a2 = await ActionService.create({ title: '本周', dueAt: tomorrow, status: 'open' }, db());
    const a3 = await ActionService.create({ title: '等待', status: 'waiting' }, db());
    const r = await ActionService.today(db());
    expect(r.today.find(x => x.id === a1.id)).toBeTruthy();
    expect(r.upcoming.find(x => x.id === a2.id)).toBeTruthy();
    expect(r.waiting.find(x => x.id === a3.id)).toBeTruthy();
  });

  it('kanban groups by status (excludes done older than today)', async () => {
    await ActionService.create({ title: 'A' }, db());
    const o = await ActionService.create({ title: 'B', status: 'open' }, db());
    const w = await ActionService.create({ title: 'C', status: 'waiting' }, db());
    const k = await ActionService.kanban(db());
    expect(k.inbox.some(x => x.title === 'A')).toBe(true);
    expect(k.open.some(x => x.id === o.id)).toBe(true);
    expect(k.waiting.some(x => x.id === w.id)).toBe(true);
  });
});
