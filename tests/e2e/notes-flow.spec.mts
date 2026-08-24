/**
 * End-to-end: Notes feature (v1.2.0)
 *  - Login
 *  - Open More → Notes → New
 *  - Fill title + MD body (live preview)
 *  - Add linked entities: contact + project
 *  - Save
 *  - Verify chips render on detail page + preview shows MD
 *  - Edit, change links, save
 *  - Backlinks: visit a Contact detail page and verify backlinks panel shows our note
 *  - Delete
 *
 * Prerequisites: server on :3000, web-spa on :5181
 * Run: playwright test tests/e2e/notes-flow.spec.mts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

async function register(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<AuthSession> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: {
      email,
      password,
      device: { name: 'e2e-notes', os: 'linux', app_version: '1.2.0' },
    },
  });
  if (!resp.ok()) throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  return resp.json() as Promise<AuthSession>;
}

async function ensureSeedData(
  api: APIRequestContext,
  token: string,
  userId: string,
): Promise<{ contactId: string; contactNickname: string; projectId: string; projectTitle: string }> {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const stamp = Date.now();
  // Create a contact
  const cResp = await api.post(`${SERVER_BASE}/api/contacts`, {
    ...auth,
    data: {
      user_id: userId,
      nickname: `E2E-联系人-${stamp}`,
      name: '测试',
      importance: 'medium',
      reminder_enabled: false,
    },
  });
  if (!cResp.ok()) throw new Error(`create contact failed: ${cResp.status()} ${await cResp.text()}`);
  const contact = (await cResp.json()) as { id: string; nickname: string };
  // Create a project
  const pResp = await api.post(`${SERVER_BASE}/api/projects`, {
    ...auth,
    data: {
      user_id: userId,
      title: `E2E-项目-${stamp}`,
      description: 'notes e2e seed',
      template: 'blank',
      stage: 'active',
    },
  });
  if (!pResp.ok()) throw new Error(`create project failed: ${pResp.status()} ${await pResp.text()}`);
  const project = (await pResp.json()) as { id: string; title: string };
  return {
    contactId: contact.id,
    contactNickname: contact.nickname,
    projectId: project.id,
    projectTitle: project.title,
  };
}

test.describe('Notes feature', () => {
  test('create note with MD preview + entity chips, edit, backlinks, delete', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `notes-${stamp}@e2e.local`, 'notes-e2e-pw-12345');
    const seed = await ensureSeedData(api, session.access_token, session.user_id);

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

    await page.goto(`${SPA_BASE}/`);
    await page.waitForSelector('.app-shell__brand-text', { timeout: 15000 });

    // ── Navigate directly to /notes/new
    await page.goto(`${SPA_BASE}/notes/new`);
    await expect(page).toHaveURL(/\/notes\/new$/);

    // ── Fill title + MD body
    await page.locator('input.note-edit__title').fill('E2E 测试笔记');

    const mdBody =
      '# 标题\n\n这是一段正文，**加粗**、*斜体*、`代码`。\n\n- 列表项 1\n- 列表项 2\n\n```ts\nconst x = 1;\n```';
    await page.locator('textarea.note-edit__body').fill(mdBody);

    // Live preview should render headings/lists/code
    const preview = page.locator('.note-edit__preview');
    await expect(preview.locator('h1', { hasText: '标题' })).toBeVisible();
    await expect(preview.locator('strong', { hasText: '加粗' })).toBeVisible();
    await expect(preview.locator('li', { hasText: '列表项 1' })).toBeVisible();
    await expect(preview.locator('pre code')).toContainText('const x = 1');

    // ── Add linked entities: contact + project (default tab is 联系人)
    await expect(page.locator('.entity-picker')).toBeVisible();
    const pickerInput = page.locator('.entity-picker__add input');
    await pickerInput.fill(seed.contactNickname);
    // Picker dropdown — use keyboard Enter to commit
    await expect(page.locator('[data-testid="searchable-picker-option"]')).toHaveCount(1, { timeout: 5000 });
    await pickerInput.press('Enter');
    await expect(page.locator('.entity-picker__chips .entity-chip')).toHaveCount(1);
    await expect(page.locator('.entity-picker__chips .entity-chip').first()).toContainText(seed.contactNickname);

    // Switch to project tab + add
    await page.getByRole('button', { name: /\+ 项目/ }).click();
    const pickerInput2 = page.locator('.entity-picker__add input');
    await pickerInput2.fill(seed.projectTitle);
    await expect(page.locator('[data-testid="searchable-picker-option"]')).toHaveCount(1, { timeout: 5000 });
    await pickerInput2.press('Enter');
    await expect(page.locator('.entity-picker__chips .entity-chip')).toHaveCount(2);

    // ── Save
    await page.getByRole('button', { name: /^保存$/ }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+$/);

    // ── Detail view: title, MD rendered, 2 chips
    await expect(page.getByRole('heading', { name: 'E2E 测试笔记' })).toBeVisible();
    await expect(page.locator('.note-detail__view .markdown-view h1', { hasText: '标题' })).toBeVisible();
    await expect(page.locator('.note-detail__chips .entity-chip')).toHaveCount(2);
    await expect(page.locator('.note-detail__chips .entity-chip').nth(0)).toContainText('联系人');
    await expect(page.locator('.note-detail__chips .entity-chip').nth(1)).toContainText('项目');

    const noteUrl = page.url();
    const noteId = noteUrl.split('/').pop()!;

    // ── Backlinks: visit contact detail page, expect our note in backlinks panel
    const contactsApi = api;
    const listResp = await contactsApi.get(
      `${SERVER_BASE}/api/notes?user_id=${session.user_id}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    expect(listResp.ok()).toBeTruthy();
    const noteBacklinksResp = await contactsApi.get(
      `${SERVER_BASE}/api/notes/backlinks?entity_type=contact&entity_id=${seed.contactId}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    expect(noteBacklinksResp.ok()).toBeTruthy();
    const backlinks = (await noteBacklinksResp.json()) as Array<{ note_id: string; note_title: string }>;
    expect(backlinks.find((b) => b.note_id === noteId)).toBeTruthy();

    await page.goto(`${SPA_BASE}/contacts/${seed.contactId}`);
    await page.waitForSelector('.contact-detail, .page', { timeout: 15000 });
    const backlinksPanel = page.locator('.backlinks-panel');
    await expect(backlinksPanel).toBeVisible({ timeout: 10000 });
    await expect(backlinksPanel.locator('.backlinks-panel__item')).toContainText('E2E 测试笔记');

    // ── Edit: remove project link, save
    await page.goto(noteUrl);
    await page.getByRole('button', { name: /^编辑$/ }).click();
    await page.locator('.note-detail__edit .entity-chip__remove').nth(1).click();
    await expect(page.locator('.note-detail__edit .entity-chip')).toHaveCount(1);
    await page.getByRole('button', { name: /^保存$/ }).click();
    await expect(page.locator('.note-detail__chips .entity-chip')).toHaveCount(1);

    // ── Delete
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /^删除$/ }).click();
    await expect(page).toHaveURL(/\/notes$/);

    // Confirm gone via API
    const getResp = await api.get(
      `${SERVER_BASE}/api/notes/${noteId}?user_id=${session.user_id}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    );
    expect(getResp.status()).toBe(404);

    await ctx.close();
  });
});