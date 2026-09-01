/**
 * Smoke: note templates picker shows 7 chips after the rename.
 * Run: pnpm exec playwright test tests/e2e/_smoke-templates.spec.mts
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
  const r = await api.post('/api/auth/register', {
    data: {
      email,
      password,
      device: { name: 'e2e-tpl-smoke', os: 'linux', app_version: '1.2.0' },
    },
  });
  if (!r.ok()) throw new Error(`register failed: ${r.status()} ${await r.text()}`);
  return (await r.json()) as Promise<AuthSession>;
}

test('notes: new-note page shows 7 quick-start templates', async ({ browser }) => {
  const api = await request.newContext({ baseURL: SERVER_BASE });
  const stamp = Date.now();
  const session = await register(api, `tpl-smoke-${stamp}@e2e.local`, 'tpl-smoke-pw-12345');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((sess) => {
    localStorage.setItem('weavine.access_token', sess.access_token);
    localStorage.setItem('weavine.refresh_token', sess.refresh_token);
    localStorage.setItem('weavine.user_id', sess.user_id);
  }, session);
  try {
    await page.goto(`${SPA_BASE}/notes/new`);
    await expect(page.locator('text=快速开始')).toBeVisible();
    const chips = page.locator('.note-edit__template');
    await expect(chips).toHaveCount(7);
    await expect(chips.nth(0)).toContainText('会议记录');
    await expect(chips.nth(1)).toContainText('沟通日志');
    await expect(chips.nth(2)).toContainText('初次见面');
    await expect(chips.nth(3)).toContainText('跟进计划');
    await expect(chips.nth(4)).toContainText('感谢日志');
    await expect(chips.nth(5)).toContainText('想法');
    await expect(chips.nth(6)).toContainText('复盘');
  } finally {
    await ctx.close();
    await api.dispose();
  }
});