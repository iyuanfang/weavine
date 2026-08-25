/**
 * E2E: Interaction becomes a first-class linkable entity.
 *
 * Tests:
 *   1. Interaction appears as a graph neighbor for a contact (with 💬 icon,
 *      no drill ⊕ button), click → /interactions/{id}.
 *   2. Notes can link to interactions via the entity picker; backlinks show
 *      up on the interaction detail page.
 *
 * Run: pnpm exec playwright test tests/e2e/interaction-as-entity.spec.mts
 */

import { test, expect, request, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface Session {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

async function register(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const r = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: {
      email,
      password,
      device: { name: 'e2e-int', os: 'linux', app_version: '1.2.0' },
    },
  });
  if (!r.ok()) throw new Error(`register failed: ${r.status()} ${await r.text()}`);
  return (await r.json()) as Session;
}

async function browserContextWithSession(
  browser: Browser,
  session: Session,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ({ token, refresh, uid }: { token: string; refresh: string; uid: string }) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    },
    { token: session.access_token, refresh: session.refresh_token, uid: session.user_id },
  );
  const page = await ctx.newPage();
  return { ctx, page };
}

test('entity graph: contact with 1 interaction shows it as neighbor; click opens interaction detail', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `int-graph-${stamp}@e2e.local`, 'int-graph-pw-12345');
  const h = { headers: { Authorization: `Bearer ${session.access_token}` } };

  const c = await api.post(`${SERVER_BASE}/api/contacts`, {
    ...h,
    data: { user_id: session.user_id, nickname: `IntAlice-${stamp}`, name: 'Alice' },
  });
  if (!c.ok()) throw new Error(`contact failed: ${c.status()} ${await c.text()}`);
  const alice = await c.json();

  const i = await api.post(`${SERVER_BASE}/api/interactions`, {
    ...h,
    data: {
      user_id: session.user_id,
      contact_id: alice.id,
      occurred_at: new Date().toISOString(),
      channel: '微信',
      summary: `IntAlice-${stamp} 微信聊了合作方向`,
    },
  });
  if (!i.ok()) throw new Error(`interaction failed: ${i.status()} ${await i.text()}`);
  const interaction = await i.json();

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    await page.goto(`${SPA_BASE}/graph/contact/${alice.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    const node = page.locator(`[data-testid="graph-node-interaction-${interaction.id}"]`);
    await expect(node).toBeVisible({ timeout: 10000 });
    // interaction is a NEIGHBOR, not a center — must NOT have ⊕ drill button
    await expect(page.locator(`[data-testid="graph-node-interaction-${interaction.id}-drill"]`)).toHaveCount(0);
    // click → /interactions/:id (detail page, not drill)
    await node.click();
    await page.waitForURL(`${SPA_BASE}/interactions/${interaction.id}`);
  } finally {
    await ctx.close();
    await api.dispose();
  }
});

test('notes: entity picker shows 互动 option; creating a note linked to an interaction makes it appear as backlink', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `int-note-${stamp}@e2e.local`, 'int-note-pw-12345');
  const h = { headers: { Authorization: `Bearer ${session.access_token}` } };

  const i = await api.post(`${SERVER_BASE}/api/interactions`, {
    ...h,
    data: {
      user_id: session.user_id,
      occurred_at: new Date().toISOString(),
      channel: '电话',
      summary: `IntNotePhone-${stamp}`,
    },
  });
  if (!i.ok()) throw new Error(`interaction failed: ${i.status()} ${await i.text()}`);
  const interaction = await i.json();

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    // 1. Direct-create a note via API that links to the interaction
    const n = await api.post(`${SERVER_BASE}/api/notes`, {
      ...h,
      data: {
        title: `IntNoteFor-${stamp}`,
        body: 'follow up on the call tomorrow',
        entity_links: [{ entity_type: 'interaction', entity_id: interaction.id }],
      },
    });
    if (!n.ok()) throw new Error(`note failed: ${n.status()} ${await n.text()}`);
    const note = await n.json();

    // 2. Open the interaction detail page; backlinks panel should show our note
    await page.goto(`${SPA_BASE}/interactions/${interaction.id}`);
    await expect(page.locator('h3:has-text("相关笔记")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.backlinks-panel')).toContainText(`IntNoteFor-${stamp}`);

    // 3. Open /notes/new — the entity picker should expose 互动 tab
    await page.goto(`${SPA_BASE}/notes/new`);
    await expect(page.locator('.entity-picker__tab', { hasText: '+ 互动' })).toBeVisible({ timeout: 10000 });
  } finally {
    await ctx.close();
    await api.dispose();
  }
});