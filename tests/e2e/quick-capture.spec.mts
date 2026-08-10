/**
 * End-to-end: QuickCapture (Ctrl+K panel) — parse + submit flow.
 *
 * Prerequisites: server on :3000, web-spa on :5181
 * Run: playwright test tests/e2e/quick-capture.spec.mts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
}

async function register(api: APIRequestContext, email: string, password: string): Promise<AuthSession> {
  const resp = await api.post(`${SERVER_BASE}/api/auth/register`, {
    data: { email, password, device: { name: 'e2e', os: 'linux', app_version: '0.0.0' } },
  });
  if (!resp.ok()) throw new Error(`register failed: ${resp.status()}`);
  return resp.json() as Promise<AuthSession>;
}

test.describe('QuickCapture (Ctrl+K panel)', () => {
  test('opens panel, parses event, shows preview, submits', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `qc-${stamp}@e2e.local`, 'qc-e2e-pw-12345');

    const ctx = await browser.newContext();
    await ctx.addInitScript(({ token, refresh, uid }: any) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    }, { token: session.access_token, refresh: session.refresh_token, uid: session.user_id });
    const page = await ctx.newPage();

    await page.goto(`${SPA_BASE}/`);
    await page.waitForSelector('.app-shell__brand-text', { timeout: 15000 });

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    const dialog = page.getByRole('dialog', { name: '快速记录' });
    await expect(dialog).toBeVisible();

    await page.locator('textarea[placeholder*="例"]').fill('周五下午 3 点和 E2E 快记开会');
    await page.waitForTimeout(500);
    await expect(page.getByText('事件')).toBeVisible();

    await page.getByRole('button', { name: '记录', exact: true }).click();
    await expect(page.getByText('已记录 ✓', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const eventsResp = await api.get(`${SERVER_BASE}/api/events`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(eventsResp.ok()).toBeTruthy();
    const events = (await eventsResp.json()) as unknown[];
    expect(events.length).toBeGreaterThan(0);

    await ctx.close();
    await api.dispose();
  });

  test('interaction parsing for Chinese input', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `qp-${stamp}@e2e.local`, 'qp-e2e-pw-12345');

    const ctx = await browser.newContext();
    await ctx.addInitScript(({ token, refresh, uid }: any) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    }, { token: session.access_token, refresh: session.refresh_token, uid: session.user_id });
    const page = await ctx.newPage();

    await page.goto(`${SPA_BASE}/`);
    await page.waitForSelector('.app-shell__brand-text', { timeout: 15000 });

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible();

    await page.locator('textarea[placeholder*="例"]').fill('和 E2E 用户吃饭聊天');
    await page.waitForTimeout(500);
    await expect(page.getByText('💬 联系')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeHidden();

    await ctx.close();
    await api.dispose();
  });

  test('panel closes on Escape', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await register(api, `qcl-${stamp}@e2e.local`, 'qcl-e2e-pw-12345');

    const ctx = await browser.newContext();
    await ctx.addInitScript(({ token, refresh, uid }: any) => {
      localStorage.setItem('weavine.access_token', token);
      localStorage.setItem('weavine.refresh_token', refresh);
      localStorage.setItem('weavine.user_id', uid);
    }, { token: session.access_token, refresh: session.refresh_token, uid: session.user_id });
    const page = await ctx.newPage();

    await page.goto(`${SPA_BASE}/`);
    await page.waitForSelector('.app-shell__brand-text', { timeout: 15000 });

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '快速记录' })).toBeHidden();

    await ctx.close();
    await api.dispose();
  });
});
