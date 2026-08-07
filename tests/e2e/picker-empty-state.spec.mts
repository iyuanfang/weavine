/**
 * End-to-end: verify SearchablePicker's emptyState slot fires when the
 * user has no projects/contacts yet, and that the "create new" CTA
 * navigates to the matching creation route.
 *
 * Run the same prerequisites as ocr-card-create.spec.mts
 * (server on :3000, web-spa on :5181, DATABASE_URL set).
 *
 * Run:
 *   playwright test tests/e2e/picker-empty-state.spec.mts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
  email?: string;
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
        name: 'playwright-e2e',
        os: 'linux',
        app_version: '0.0.0-e2e',
      },
    },
  });
  if (!resp.ok()) {
    throw new Error(
      `register failed: ${resp.status()} ${await resp.text()}`,
    );
  }
  const session = (await resp.json()) as AuthSession;
  expect(session.user_id).toBeTruthy();
  expect(session.access_token).toBeTruthy();
  return session;
}

async function seedAuth(
  page: import('@playwright/test').Page,
  session: AuthSession,
) {
  await page.addInitScript((s: AuthSession) => {
    window.localStorage.setItem('weavine.access_token', s.access_token);
    window.localStorage.setItem('weavine.refresh_token', s.refresh_token);
    window.localStorage.setItem('weavine.user_id', s.user_id);
    if (s.email) window.localStorage.setItem('weavine.email', s.email);
  }, session);
}

test.describe('SearchablePicker emptyState CTA', () => {
  test('EventNew — project + contact pickers show emptyState for a fresh user', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await registerAndLogin(
      api,
      `picker-${stamp}@e2e.local`,
      'picker-e2e-pw-12345',
    );
    await seedAuth(page, session);

    await page.goto(`${baseURL ?? SPA_BASE}/events/new`);
    await expect(
      page.getByRole('heading', { name: '新建日程' }),
    ).toBeVisible();

    // Project picker — open the dropdown by clicking the input
    const projectInput = page.getByPlaceholder('搜索项目…');
    await projectInput.click();
    await expect(page.getByTestId('picker-empty-project')).toBeVisible();
    await expect(page.getByTestId('picker-empty-project-create')).toHaveText(
      '新建项目',
    );

    // Contact picker — switch focus
    const contactInput = page.getByPlaceholder('搜索联系人…');
    await contactInput.click();
    await expect(page.getByTestId('picker-empty-contact')).toBeVisible();
    await expect(page.getByTestId('picker-empty-contact-create')).toHaveText(
      '新建联系人',
    );

    // Click the "新建联系人" link → should navigate to /contacts/new
    await page.getByTestId('picker-empty-contact-create').click();
    await page.waitForURL(/\/contacts\/new/);
    await expect(
      page.getByRole('heading', { name: '新建联系人' }),
    ).toBeVisible();

    await api.dispose();
  });

  test('ActionNew — emptyState CTA navigates to /projects/new', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await registerAndLogin(
      api,
      `picker-action-${stamp}@e2e.local`,
      'picker-action-e2e-pw-12345',
    );
    await seedAuth(page, session);

    await page.goto(`${baseURL ?? SPA_BASE}/actions/new`);
    await expect(
      page.getByRole('heading', { name: '新建待办' }),
    ).toBeVisible();

    const projectInput = page.getByPlaceholder('搜索项目…');
    await projectInput.click();
    await expect(page.getByTestId('picker-empty-project-create')).toBeVisible();

    await page.getByTestId('picker-empty-project-create').click();
    await page.waitForURL(/\/projects\/new/);

    await api.dispose();
  });

  test('emptyState does NOT fire when options exist but search has no match', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const session = await registerAndLogin(
      api,
      `picker-filtered-${stamp}@e2e.local`,
      'picker-filtered-e2e-pw-12345',
    );
    await seedAuth(page, session);

    // Seed one contact via API so the picker has options but the
    // search will yield zero matches.
    const createResp = await api.post(`${SERVER_BASE}/api/contacts`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: {
        user_id: session.user_id,
        nickname: 'Seed',
      },
    });
    expect(createResp.ok()).toBeTruthy();

    await page.goto(`${baseURL ?? SPA_BASE}/events/new`);
    const contactInput = page.getByPlaceholder('搜索联系人…');
    await contactInput.click();
    await contactInput.fill('zzzzzzzzz-no-match-zzzzzzzzz');

    // emptyState CTA must NOT be shown — should see the plain emptyText instead
    await expect(page.getByTestId('picker-empty-contact')).toHaveCount(0);
    await expect(page.getByText('没有匹配的联系人')).toBeVisible();

    await api.dispose();
  });
});