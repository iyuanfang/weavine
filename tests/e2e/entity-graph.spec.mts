/**
 * End-to-end: entity association graph (/graph/:entityType/:entityId).
 *
 * Seeds a contact + project + event + action + note that are all
 * inter-linked, then verifies each of the 5 centers renders the right
 * neighbors and that click-to-drill + breadcrumb navigation work.
 */

import { test, expect, request, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface Session { user_id: string; access_token: string; refresh_token: string; }

async function register(api: APIRequestContext, email: string, password: string): Promise<Session> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: {
      email,
      password,
      device: { name: 'playwright-e2e-graph', os: 'linux', app_version: '0.0.0-e2e' },
    },
  });
  if (!resp.ok()) throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  return resp.json();
}

async function seed(ctx: APIRequestContext, token: string) {
  const h = { Authorization: `Bearer ${token}` };
  const c1 = await ctx.post(`${SERVER_BASE}/api/contacts`, { headers: h, data: { nickname: 'Alice' } });
  if (!c1.ok()) throw new Error(`contact1 failed: ${c1.status()} ${await c1.text()}`);
  const alice = await c1.json();
  const c2 = await ctx.post(`${SERVER_BASE}/api/contacts`, { headers: h, data: { nickname: 'Bob' } });
  if (!c2.ok()) throw new Error(`contact2 failed: ${c2.status()} ${await c2.text()}`);
  const bob = await c2.json();

  const p1 = await ctx.post(`${SERVER_BASE}/api/projects`, {
    headers: h,
    data: { title: 'GraphSeedProject', template: 'general', stage: 'open' },
  });
  if (!p1.ok()) throw new Error(`project failed: ${p1.status()} ${await p1.text()}`);
  const project = await p1.json();

  await ctx.post(`${SERVER_BASE}/api/projects/${project.id}/contacts`, {
    headers: h, data: { contact_id: alice.id, role: 'lead' },
  });
  await ctx.post(`${SERVER_BASE}/api/projects/${project.id}/contacts`, {
    headers: h, data: { contact_id: bob.id, role: 'member' },
  });

  const e1 = await ctx.post(`${SERVER_BASE}/api/events`, {
    headers: h,
    data: {
      title: 'GraphSeedEvent',
      start_at: new Date(Date.now() + 86400000).toISOString(),
      contact_id: alice.id,
      project_id: project.id,
    },
  });
  if (!e1.ok()) throw new Error(`event failed: ${e1.status()} ${await e1.text()}`);
  const event = await e1.json();

  const a1 = await ctx.post(`${SERVER_BASE}/api/actions`, {
    headers: h,
    data: { title: 'GraphSeedAction', contact_id: alice.id, project_id: project.id },
  });
  if (!a1.ok()) throw new Error(`action failed: ${a1.status()} ${await a1.text()}`);
  const action = await a1.json();

  const n1 = await ctx.post(`${SERVER_BASE}/api/notes`, {
    headers: h,
    data: {
      title: 'GraphSeedNote',
      body: 'seeded for graph e2e',
      entity_links: [
        { entity_type: 'contact', entity_id: alice.id },
        { entity_type: 'project', entity_id: project.id },
        { entity_type: 'event', entity_id: event.id },
        { entity_type: 'action', entity_id: action.id },
      ],
    },
  });
  if (!n1.ok()) throw new Error(`note failed: ${n1.status()} ${await n1.text()}`);
  const note = await n1.json();

  const t1 = await ctx.post(`${SERVER_BASE}/api/tags`, {
    headers: h, data: { name: 'VIP', color: '#f59e0b' },
  });
  if (!t1.ok()) throw new Error(`tag failed: ${t1.status()} ${await t1.text()}`);
  const tag = await t1.json();
  const up = await ctx.put(`${SERVER_BASE}/api/contacts/${alice.id}`, {
    headers: h, data: { tag_ids: [tag.id] },
  });
  if (!up.ok()) throw new Error(`contact-tag-assign failed: ${up.status()} ${await up.text()}`);

  return { alice, bob, project, event, action, note, tag };
}

async function browserContextWithSession(browser: BrowserContext, session: Session): Promise<{ ctx: BrowserContext; page: Page }> {
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

test('entity graph: contact center shows project + event + action + note + bob', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `entity-graph-${stamp}@e2e.local`, 'entity-graph-e2e-pw-12345');
  const seeded = await seed(api, session.access_token);

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    await page.goto(`${SPA_BASE}/graph/contact/${seeded.alice.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-testid="graph-center"]')).toContainText('Alice');

    await expect(page.locator(`[data-testid="graph-node-project-${seeded.project.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-event-${seeded.event.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-action-${seeded.action.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-note-${seeded.note.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-tag-${seeded.tag.id}"]`)).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('entity graph: project center lists contacts and supports drill-down + breadcrumb', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `entity-graph-proj-${stamp}@e2e.local`, 'entity-graph-proj-pw-12345');
  const seeded = await seed(api, session.access_token);

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    await page.goto(`${SPA_BASE}/graph/project/${seeded.project.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-contact-${seeded.bob.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-event-${seeded.event.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-action-${seeded.action.id}"]`)).toBeVisible();

    await page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}-drill"]`).click();

    await page.waitForURL(new RegExp(`/graph/contact/${seeded.alice.id}$`));
    await expect(page.locator('[data-testid="graph-breadcrumb"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-breadcrumb"]')).toContainText('GraphSeedProject');
    await expect(page.locator('[data-testid="graph-breadcrumb"]')).toContainText('Alice');

    await expect(page.locator('[data-testid="graph-center"]')).toContainText('Alice');
  } finally {
    await ctx.close();
  }
});

test('entity graph: event center single-click on contact node opens contact detail', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `entity-graph-evt-${stamp}@e2e.local`, 'entity-graph-evt-pw-12345');
  const seeded = await seed(api, session.access_token);

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    await page.goto(`${SPA_BASE}/graph/event/${seeded.event.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-project-${seeded.project.id}"]`)).toBeVisible();

    await page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`).click();

    await page.waitForURL(`${SPA_BASE}/contacts/${seeded.alice.id}`);
  } finally {
    await ctx.close();
  }
});

test('entity graph: action + note centers render with their direct neighbors', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `entity-graph-an-${stamp}@e2e.local`, 'entity-graph-an-pw-12345');
  const seeded = await seed(api, session.access_token);

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    await page.goto(`${SPA_BASE}/graph/action/${seeded.action.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-project-${seeded.project.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="graph-node-note-${seeded.note.id}"]`)).toBeVisible();
  } finally {
    await ctx.close();
  }

  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(
    ({ token, refresh, uid }: { token: string; refresh: string; uid: string }) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    },
    { token: session.access_token, refresh: session.refresh_token, uid: session.user_id },
  );
  const page2 = await ctx2.newPage();
  try {
    await page2.goto(`${SPA_BASE}/graph/note/${seeded.note.id}`);
    await expect(page2.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await expect(page2.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`)).toBeVisible();
    await expect(page2.locator(`[data-testid="graph-node-project-${seeded.project.id}"]`)).toBeVisible();
    await expect(page2.locator(`[data-testid="graph-node-event-${seeded.event.id}"]`)).toBeVisible();
    await expect(page2.locator(`[data-testid="graph-node-action-${seeded.action.id}"]`)).toBeVisible();
  } finally {
    await ctx2.close();
  }
});

test('entity graph: tag center is drillable + click on tag node opens /tags/:id (regression for 404)', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `entity-graph-tag-${stamp}@e2e.local`, 'entity-graph-tag-pw-12345');
  const seeded = await seed(api, session.access_token);

  const { ctx, page } = await browserContextWithSession(browser, session);
  try {
    // 1. tag is reachable as a graph center
    await page.goto(`${SPA_BASE}/graph/tag/${seeded.tag.id}`);
    await expect(page.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="graph-center"]')).toContainText('VIP');
    await expect(page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}"]`)).toBeVisible();

    // 2. drill button on a tag neighbor (the contact) works → goes to /graph/contact/:id
    await page.locator(`[data-testid="graph-node-contact-${seeded.alice.id}-drill"]`).click();
    await page.waitForURL(new RegExp(`/graph/contact/${seeded.alice.id}$`));
    await expect(page.locator('[data-testid="graph-breadcrumb"]')).toContainText('VIP');

    // 3. drill breadcrumb back to tag center
    await page.locator('[data-testid="graph-breadcrumb"] button').first().click();
    await page.waitForURL(new RegExp(`/graph/tag/${seeded.tag.id}$`));
  } finally {
    await ctx.close();
  }

  // 4. click on tag neighbor (from contact center) opens /tags/:id — used to 404 before
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await ctx2.addInitScript(
    ({ token, refresh, uid }: { token: string; refresh: string; uid: string }) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    },
    { token: session.access_token, refresh: session.refresh_token, uid: session.user_id },
  );
  try {
    await page2.goto(`${SPA_BASE}/graph/contact/${seeded.alice.id}`);
    await expect(page2.locator('[data-testid="graph-svg"]')).toBeVisible({ timeout: 15000 });
    await page2.locator(`[data-testid="graph-node-tag-${seeded.tag.id}"]`).click();
    await page2.waitForURL(`${SPA_BASE}/tags/${seeded.tag.id}`);
  } finally {
    await ctx2.close();
  }
});
