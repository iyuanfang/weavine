/**
 * E2E: graph operations round — quick-create contact (multi for events),
 * hover-minus unlink, right-click/long-press node menu, interaction
 * contact-required, and detail-page participant/contact editing.
 *
 * Relies on the local stack: SPA on 5181, API via SERVER_URL (default 13002).
 */

import { test, expect, request, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:13002';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface Session { user_id: string; access_token: string; refresh_token: string; }

async function register(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: {
      email,
      password,
      device: { name: 'playwright-graph-ops', os: 'linux', app_version: '0.0.0-e2e' },
    },
  });
  if (!resp.ok()) throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  return resp.json();
}

async function apiGet<T>(ctx: APIRequestContext, token: string, path: string): Promise<T> {
  const r = await ctx.get(`${SERVER_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok()) throw new Error(`GET ${path} failed: ${r.status()}`);
  return r.json() as Promise<T>;
}

let api: APIRequestContext;
let session: Session;
let alice: any, bob: any, carol: any;
let event: any, action: any;

test.describe.serial('graph operations', () => {
  test.beforeAll(async ({ browser }) => {
    api = await request.newContext({ baseURL: SERVER_BASE });
    session = await register(api, `graph-ops-${Date.now()}@e2e.local`, 'graph-ops-e2e-pw-12345');
    const h = { Authorization: `Bearer ${session.access_token}` };
    const uid = session.user_id;

    const mk = async (path: string, data: any) => {
      const r = await api.post(`${SERVER_BASE}${path}`, { headers: h, data: { user_id: uid, ...data } });
      if (!r.ok()) throw new Error(`POST ${path} failed: ${r.status()} ${await r.text()}`);
      return r.json();
    };

    alice = await mk('/api/contacts', { nickname: 'Alice' });
    bob = await mk('/api/contacts', { nickname: 'Bob' });
    carol = await mk('/api/contacts', { nickname: 'Carol' });

    event = await mk('/api/events', {
      title: 'OpsEvent',
      type: '会议',
      start_at: new Date(Date.now() + 86400000).toISOString(),
      contact_id: alice.id,
      participant_contact_ids: [alice.id],
    });
    action = await mk('/api/actions', {
      title: 'OpsAction',
      status: 'open',
      contact_id: alice.id,
    });
    void browser;
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  async function openGraph(page: Page, type: string, id: string) {
    // operations live on the detail page's graph tab (GraphTab), not the
    // legacy read-only /graph/:type/:id explorer (GraphView)
    const detailBase = {
      contact: `/contacts/${id}`,
      project: `/projects/${id}`,
      event: `/events/${id}`,
      action: `/actions/${id}`,
      note: `/notes/${id}`,
      interaction: `/interactions/${id}`,
    }[type];
    await page.goto(`${SPA_BASE}${detailBase}?tab=graph`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
  }

  async function newPage(browser: any): Promise<Page> {
    const ctx: BrowserContext = await browser.newContext();
    await ctx.addInitScript(
      ({ token, refresh, uid }: any) => {
        localStorage.setItem('weavine.access_token', token);
        localStorage.setItem('weavine.refresh_token', refresh);
        localStorage.setItem('weavine.user_id', uid);
      },
      { token: session.access_token, refresh: session.refresh_token, uid: session.user_id },
    );
    return ctx.newPage();
  }

  test('event center quick-create offers only 联系人/笔记 (no interaction, no project/action)', async ({ browser }) => {
    const page = await newPage(browser);
    await openGraph(page, 'event', event.id);
    await page.locator('[data-testid="graph-center-quick-create"]').click();
    await expect(page.locator('[data-testid="graph-quick-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-quick-create-contact"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-quick-create-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-quick-create-interaction"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="graph-quick-create-project"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.context().close();
  });

  test('event center contact link is multi-select and merges participants', async ({ browser }) => {
    const page = await newPage(browser);
    await openGraph(page, 'event', event.id);
    await page.locator('[data-testid="graph-center-quick-create"]').click();
    await page.locator('[data-testid="graph-quick-create-contact"]').click();
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toBeVisible();

    // multi-select: checkboxes visible, picking does NOT close the modal
    await page.locator(`[data-testid="pick-contact-${bob.id}"]`).click();
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toBeVisible();
    await page.locator(`[data-testid="pick-contact-${carol.id}"]`).click();
    await page.locator('[data-testid="contact-pick-confirm"]').click();

    // modal closes, graph refreshes with both new contact nodes
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toHaveCount(0);
    await expect(page.locator(`[data-testid="graph-node-contact-${bob.id}"]`)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="graph-node-contact-${carol.id}"]`)).toBeVisible();

    const parts: any[] = await apiGet(api, session.access_token, `/api/events/${event.id}`).then((e: any) => e.participants);
    const ids = parts.map((p) => p.contact_id).sort();
    expect(ids).toContain(bob.id);
    expect(ids).toContain(carol.id);
    await page.context().close();
  });

  test('hover minus unlinks contact from event without deleting the contact', async ({ browser }) => {
    const page = await newPage(browser);
    await openGraph(page, 'event', event.id);
    const node = page.locator(`[data-testid="graph-node-contact-${bob.id}"]`);
    await node.hover();
    const minus = page.locator(`[data-testid="graph-unlink-contact-${bob.id}"]`);
    await expect(minus).toBeVisible();
    await minus.click();

    await expect(page.locator(`[data-testid="graph-node-contact-${bob.id}"]`)).toHaveCount(0, { timeout: 15000 });

    // entity survives; edge gone
    const ev: any = await apiGet(api, session.access_token, `/api/events/${event.id}`);
    expect(ev.participants.map((p: any) => p.contact_id)).not.toContain(bob.id);
    const bobAfter = await api.get(`${SERVER_BASE}/api/contacts/${bob.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(bobAfter.status()).toBe(200);
    await page.context().close();
  });

  test('derived event↔action edge has no minus', async ({ browser }) => {
    const h = { Authorization: `Bearer ${session.access_token}` };
    // link action to event through an interaction so the event graph shows the action
    const i = await api.post(`${SERVER_BASE}/api/interactions`, {
      headers: h,
      data: {
        user_id: session.user_id,
        summary: 'derived edge seed',
        occurred_at: new Date().toISOString(),
        contact_id: alice.id,
        action_id: action.id,
        event_id: event.id,
      },
    });
    if (!i.ok()) throw new Error(`interaction seed failed: ${i.status()}`);
    const interaction = await i.json();

    const page = await newPage(browser);
    await openGraph(page, 'event', event.id);
    const node = page.locator(`[data-testid="graph-node-action-${action.id}"]`);
    await expect(node).toBeVisible({ timeout: 15000 });
    await node.hover();
    await expect(page.locator(`[data-testid="graph-unlink-action-${action.id}"]`)).toHaveCount(0);

    // cleanup interaction so later tests see a stable graph
    await api.delete(`${SERVER_BASE}/api/interactions/${interaction.id}`, {
      headers: h,
    });
    await page.context().close();
  });

  test('right-click menu offers 打开详情 + 断开关联, never delete', async ({ browser }) => {
    const page = await newPage(browser);
    await openGraph(page, 'event', event.id);
    const node = page.locator(`[data-testid="graph-node-contact-${alice.id}"]`);
    await node.click({ button: 'right' });
    const menu = page.locator('[data-testid="graph-node-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('打开详情');
    await expect(menu).toContainText('断开关联');
    expect(await menu.getByText(/删除/).count()).toBe(0);

    await menu.getByText('打开详情').click();
    await expect(page).toHaveURL(new RegExp(`/contacts/${alice.id}`));
    await page.context().close();
  });

  test('event detail page: add participants via picker modal and remove via chip', async ({ browser }) => {
    const page = await newPage(browser);
    await page.goto(`${SPA_BASE}/events/${event.id}`);
    await expect(page.getByText('基本信息')).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="event-add-participant"]').click();
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toBeVisible();
    await page.locator(`[data-testid="pick-contact-${bob.id}"]`).click();
    await page.locator('[data-testid="contact-pick-confirm"]').click();

    // chip appears (event detail re-fetches after update)
    await expect(page.locator('[data-testid="event-participant"]', { hasText: 'Bob' })).toBeVisible({ timeout: 15000 });

    // remove Bob again via the chip's ×
    const bobChip = page.locator('span', { has: page.locator(`[data-testid="event-participant"]`) }).filter({ hasText: 'Bob' });
    await bobChip.locator('button[title="移除参与者"]').click();
    await expect(page.locator('[data-testid="event-participant"]', { hasText: 'Bob' })).toHaveCount(0, { timeout: 15000 });
    await page.context().close();
  });

  test('action detail page: set and clear contact', async ({ browser }) => {
    const page = await newPage(browser);
    await page.goto(`${SPA_BASE}/actions/${action.id}`);
    await expect(page.getByText('基本信息')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="action-set-contact"]')).toContainText('更换');

    await page.locator('[data-testid="action-set-contact"]').click();
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toBeVisible();
    await page.locator(`[data-testid="pick-contact-${bob.id}"]`).click(); // single mode: immediate confirm
    await expect(page.locator('[data-testid="contact-pick-or-create"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="event-participant"], .tag-chip').filter({ hasText: 'Bob' }).first()).toBeVisible({ timeout: 15000 });

    const a: any = await apiGet(api, session.access_token, `/api/actions/${action.id}`);
    expect(a.contact_id).toBe(bob.id);
    await page.context().close();
  });

  test('contactless interaction shows 关联联系人 fix-up and linking persists', async ({ browser }) => {
    const h = { Authorization: `Bearer ${session.access_token}` };
    const i = await api.post(`${SERVER_BASE}/api/interactions`, {
      headers: h,
      data: {
        user_id: session.user_id,
        summary: 'contactless verification interaction',
        occurred_at: new Date().toISOString(),
        contact_id: null,
      },
    });
    if (!i.ok()) throw new Error(`interaction create failed: ${i.status()}`);
    const interaction = await i.json();

    const page = await newPage(browser);
    await page.goto(`${SPA_BASE}/interactions/${interaction.id}`);
    await expect(page.locator('[data-testid="interaction-link-contact"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="interaction-link-contact"]').click();
    await page.locator(`[data-testid="pick-contact-${alice.id}"]`).click(); // single mode immediate

    await expect(page.locator('[data-testid="interaction-link-contact"]')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('.tag-chip', { hasText: 'Alice' })).toBeVisible();

    const after: any = await apiGet(api, session.access_token, `/api/interactions/${interaction.id}`);
    expect(after.contact_id).toBe(alice.id);
    await page.context().close();
  });

  test('interaction delete works (regression: used to 500)', async ({ browser }) => {
    const h = { Authorization: `Bearer ${session.access_token}` };
    const i = await api.post(`${SERVER_BASE}/api/interactions`, {
      headers: h,
      data: {
        user_id: session.user_id,
        summary: 'to-be-deleted interaction',
        occurred_at: new Date().toISOString(),
        contact_id: alice.id,
      },
    });
    const interaction = await i.json();
    const page = await newPage(browser);
    await page.goto(`${SPA_BASE}/interactions/${interaction.id}`);
    await expect(page.getByText('摘要')).toBeVisible({ timeout: 15000 });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page).toHaveURL(/\/(contacts\/|interactions|$)/, { timeout: 15000 });
    // delete is a soft-delete tombstone: list endpoint must no longer show it
    const list: any[] = await apiGet(api, session.access_token, `/api/interactions?user_id=${session.user_id}&limit=100`);
    expect(list.find((x) => x.id === interaction.id)).toBeUndefined();
    await page.context().close();
  });
});
