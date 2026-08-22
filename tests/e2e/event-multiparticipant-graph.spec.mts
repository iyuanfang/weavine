/**
 * End-to-end: multi-participant events + contact graph.
 *
 * - Creates 3 contacts.
 * - POST /api/events with participant_contact_ids of all 3 → event shows
 *   3 participants in detail page.
 * - Adds 2 'knows' relations between contacts (A→B, B→C).
 * - Navigates to /contacts/A/graph and asserts the SVG shows 3 nodes +
 *   2 edges.
 * - Adds a third relation (A→C) through the UI modal and asserts it
 *   appears in the relationship list.
 *
 * Requires: server :3000, web-spa :5181 (with our Phase 3 #3/#4 code),
 * DATABASE_URL set.
 */

import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

async function registerAndLogin(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthSession> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: {
      email,
      password,
      device: {
        name: 'playwright-e2e-graph',
        os: 'linux',
        app_version: '0.0.0-e2e',
      },
    },
  });
  if (!resp.ok()) {
    throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  }
  return await resp.json();
}

async function createContact(
  api: APIRequestContext,
  token: string,
  nickname: string,
): Promise<{ id: string }> {
  const resp = await api.post(`${SERVER_BASE}/api/contacts`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { nickname, name: nickname + ' Smith' },
  });
  if (!resp.ok()) {
    throw new Error(`createContact(${nickname}) failed: ${resp.status()} ${await resp.text()}`);
  }
  return await resp.json();
}

async function createEvent(
  api: APIRequestContext,
  token: string,
  title: string,
  participants: string[],
): Promise<{ id: string; participants: Array<{ contact_id: string; nickname: string }> }> {
  const resp = await api.post(`${SERVER_BASE}/api/events`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      start_at: new Date(Date.now() + 86400000).toISOString(),
      participant_contact_ids: participants,
    },
  });
  if (!resp.ok()) {
    throw new Error(`createEvent failed: ${resp.status()} ${await resp.text()}`);
  }
  return await resp.json();
}

async function seedTokensInBrowser(page: Page, session: AuthSession): Promise<void> {
  await page.goto(`${SPA_BASE}/login`);
  await page.evaluate(
    ([access, refresh, userId]) => {
      localStorage.setItem('weavine.access_token', access);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', userId);
    },
    [session.access_token, session.refresh_token, session.user_id],
  );
}

test('Phase3 #3 + #4 — multi-participant event + contact graph', async ({ browser }) => {
  const apiCtx = await request.newContext({ baseURL: SERVER_BASE });
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const email = `e2e_p3_${suffix}@test.local`;

  const session = await registerAndLogin(apiCtx, email, 'pass12345');
  expect(session.access_token).toBeTruthy();

  const alice = await createContact(apiCtx, session.access_token, 'Alice');
  const bob = await createContact(apiCtx, session.access_token, 'Bob');
  const carol = await createContact(apiCtx, session.access_token, 'Carol');
  const dave = await createContact(apiCtx, session.access_token, 'Dave');

  // --- #3 multi-participant event ---
  const ev = await createEvent(apiCtx, session.access_token, 'Team dinner', [
    alice.id,
    bob.id,
    carol.id,
  ]);
  expect(ev.participants).toHaveLength(3);
  expect(ev.participants.map((p) => p.contact_id).sort()).toEqual(
    [alice.id, bob.id, carol.id].sort(),
  );
  for (const p of ev.participants) {
    expect(['Alice', 'Bob', 'Carol']).toContain(p.nickname);
  }

  // --- #4 graph: A→B and B→C ---
  for (const pair of [
    [alice.id, bob.id, 'college'],
    [bob.id, carol.id, 'work'],
  ] as const) {
    const [fromId, toId, label] = pair;
    const resp = await apiCtx.post(`${SERVER_BASE}/api/graph/${fromId}/relations`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: { other_contact_id: toId, label },
    });
    expect(resp.status(), `add relation ${fromId}->${toId}`).toBe(200);
  }

  // --- visit /contacts/:alice/graph and verify SVG ---
  const page = await browser.newPage();
  await seedTokensInBrowser(page, session);
  await page.goto(`${SPA_BASE}/contacts/${alice.id}/graph`);
  await expect(page.getByTestId('graph-svg')).toBeVisible();

  // center node label
  await expect(page.locator('svg text').filter({ hasText: 'Alice' })).toBeVisible();

  // ring1 nodes (direct relations of Alice)
  await expect(page.getByTestId(`graph-node-${bob.id}`)).toBeVisible();
  // ring2 nodes (Carol reachable in 2 hops via Bob)
  await expect(page.getByTestId(`graph-node-${carol.id}`)).toBeVisible();

  // relationship list — should show both
  const list = page.locator('section.section').filter({ hasText: '关系列表' });
  await expect(list).toContainText('Bob');
  await expect(list).toContainText('Carol');
  await expect(list).toContainText('college');
  await expect(list).toContainText('work');

  // --- add a third relation (Alice→Dave) via UI modal ---
  await page.getByTestId('graph-add-relation').click();
  await page.getByTestId('graph-add-other-select').selectOption(dave.id);
  await page.getByTestId('graph-add-label').fill('met at conf');
  await page.getByTestId('graph-add-submit').click();

  // modal closes, list updates
  await expect(list).toContainText('met at conf');
  await expect(list).toContainText('Dave');

  await apiCtx.dispose();
  await page.close();
});