/**
 * End-to-end: Event reminder derivation + cross-end dispatch.
 *
 * Flow:
 *   1. Create user via /api/auth/register
 *   2. POST /api/events with reminder_lead_minutes set
 *   3. Verify /api/reminders contains a reminder with invitation_token
 *      matching `event:{event_id}:{lead_minutes}` and trigger_at = start_at - lead
 *   4. Update event with new reminder_lead_minutes and verify reminder UPSERTs
 *   5. Update event with reminder_lead_minutes=0 and verify reminder is deleted
 *
 * Prerequisites: server on :3000, web-spa on :5181
 * Run: playwright test tests/e2e/reminder-toast.spec.mts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  reminder_lead_minutes: number | null;
  contact_id: string | null;
}

interface ReminderRow {
  id: string;
  event_id: string | null;
  trigger_at: string;
  kind: 'time' | 'cadence';
  invitation_token: string | null;
  dispatched: boolean;
  dismissed: boolean;
}

async function register(api: APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: { email, password, device: { name: 'e2e', os: 'linux', app_version: '0.0.0' } },
  });
  if (!resp.ok()) throw new Error(`register failed: ${resp.status()}`);
  return resp.json() as Promise<AuthSession>;
}

async function createEvent(api: APIRequestContext, token: string, body: Record<string, unknown>): Promise<EventRow> {
  const resp = await api.post(`${SERVER_BASE}/api/events`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  if (!resp.ok()) throw new Error(`create event failed: ${resp.status()} ${await resp.text()}`);
  return resp.json() as Promise<EventRow>;
}

async function updateEvent(api: APIRequestContext, token: string, id: string, body: Record<string, unknown>): Promise<EventRow> {
  const resp = await api.put(`${SERVER_BASE}/api/events/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  if (!resp.ok()) throw new Error(`update event failed: ${resp.status()} ${await resp.text()}`);
  return resp.json() as Promise<EventRow>;
}

async function listReminders(api: APIRequestContext, token: string, event_id?: string): Promise<ReminderRow[]> {
  const qs = event_id ? `?event_id=${event_id}` : '';
  const resp = await api.get(`${SERVER_BASE}/api/reminders${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) throw new Error(`list reminders failed: ${resp.status()}`);
  return resp.json() as Promise<ReminderRow[]>;
}

test.describe('Event reminder auto-derivation', () => {
  test('derives reminder on event create with lead, upserts on update, deletes on lead=0', async () => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `rem-${stamp}@e2e.local`, 'rem-e2e-pw-12345');

    // Start at 2026-08-15 10:00 UTC so trigger_at math is deterministic
    const startAt = '2026-08-15T10:00:00Z';

    // 1. Create event with reminder_lead_minutes=15
    const event = await createEvent(api, session.access_token, {
      title: '提醒测试',
      type: '会议',
      start_at: startAt,
      reminder_lead_minutes: 15,
    });
    expect(event.id).toBeTruthy();
    expect(event.reminder_lead_minutes).toBe(15);

    // Reminder should be derived: trigger_at = start_at - 15min = 09:45Z
    const after = await listReminders(api, session.access_token, event.id);
    expect(after.length).toBe(1);
    const rem = after[0]!;
    expect(rem.event_id).toBe(event.id);
    expect(rem.kind).toBe('time');
    expect(rem.invitation_token).toBe(`event:${event.id}:15`);
    expect(rem.trigger_at.replace('+00:00', 'Z')).toBe('2026-08-15T09:45:00Z');
    expect(rem.dispatched).toBe(false);
    expect(rem.dismissed).toBe(false);

    // 2. Update lead to 30 — should UPSERT (token changes, history preserved by new row)
    await updateEvent(api, session.access_token, event.id, { reminder_lead_minutes: 30 });
    const after2 = await listReminders(api, session.access_token, event.id);
    expect(after2.length).toBe(1);
    const rem2 = after2[0]!;
    expect(rem2.invitation_token).toBe(`event:${event.id}:30`);
    expect(rem2.trigger_at.replace('+00:00', 'Z')).toBe('2026-08-15T09:30:00Z');

    // 3. Set lead=0 — reminder should be deleted
    await updateEvent(api, session.access_token, event.id, { reminder_lead_minutes: 0 });
    const after3 = await listReminders(api, session.access_token, event.id);
    expect(after3.length).toBe(0);

    await api.dispose();
  });

  test('no reminder created when reminder_lead_minutes is omitted', async () => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `norem-${stamp}@e2e.local`, 'norem-e2e-pw-12345');

    const event = await createEvent(api, session.access_token, {
      title: '无提醒测试',
      type: '其他',
      start_at: '2026-08-15T10:00:00Z',
    });

    const reminders = await listReminders(api, session.access_token, event.id);
    expect(reminders.length).toBe(0);

    await api.dispose();
  });
});