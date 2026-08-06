/**
 * End-to-end: upload a business card image → OCR extracts fields →
 * apply them to the ContactNew form → submit → contact is created
 * on the weavine-server and visible on /contacts.
 *
 * Prerequisites (start before running):
 *   1. Postgres with `weavine` role + `weavine` database
 *      → DATABASE_URL=postgres://weavine:<pwd>@127.0.0.1/weavine
 *   2. weavine-server on :3000 (cargo run --bin weavine-server)
 *      → auto-applies migrations on boot
 *   3. web-spa dev server on :5181 (pnpm --dir apps/web-spa dev)
 *      → vite proxies /api/* → :3000
 *   4. Tesseract 5.x + chi_sim/chi_tra/eng traineddata
 *      → apt install tesseract-ocr tesseract-ocr-chi-sim tesseract-ocr-chi-tra
 *
 * Run:
 *   DATABASE_URL=postgres://weavine:weavine@127.0.0.1/weavine \
 *     playwright test tests/e2e/ocr-card-create.spec.ts
 *
 * Image used: ../../c5cebda1d4baeaf268e1fa40e14edf03.jpg
 *   (a real Chinese business card, 1078×653 JPEG, ~175 KB)
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARD_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'c5cebda1d4baeaf268e1fa40e14edf03.jpg',
);

interface AuthSession {
  user_id: string;
  access_token: string;
  refresh_token: string;
  email?: string;
}

/**
 * Register a fresh user against the running server and persist the
 * session into the browser's localStorage so the web-spa's adapter
 * picks it up on next page load.
 */
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
  expect(session.refresh_token).toBeTruthy();
  return session;
}

test.describe('OCR → contact creation', () => {
  test('scans card image, fills form, saves contact', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const email = `playwright-${stamp}@e2e.local`;
    const password = 'playwright-e2e-pw-12345';

    const session = await registerAndLogin(api, email, password);

    // Seed localStorage so the SPA's auth adapter skips its own login UI.
    await page.addInitScript((s: AuthSession) => {
      window.localStorage.setItem('weavine.access_token', s.access_token);
      window.localStorage.setItem('weavine.refresh_token', s.refresh_token);
      window.localStorage.setItem('weavine.user_id', s.user_id);
      if (s.email) window.localStorage.setItem('weavine.email', s.email);
    }, session);

    // 1. Navigate to /contacts/new
    await page.goto(`${baseURL ?? SPA_BASE}/contacts/new`);
    await expect(
      page.getByRole('heading', { name: '新建联系人' }),
    ).toBeVisible();

    // 2. Upload the card image
    const fileInput = page.getByTestId('card-scanner-input');
    await fileInput.setInputFiles(CARD_PATH);

    // 3. Wait for OCR result panel
    await expect(page.getByTestId('card-scanner-busy')).toBeVisible();
    await expect(page.getByTestId('card-scanner-confidence')).toBeVisible(
      { timeout: 15_000 },
    );

    // Confidence should be a numeric percentage; Tesseract returns 0-100
    const confidenceText = await page
      .getByTestId('card-scanner-confidence')
      .textContent();
    expect(confidenceText).toMatch(/置信度 \d+%/);

    // The fields panel should have rendered at least one extracted field
    // (real Chinese cards always have at least a name and a phone number).
    const fieldsPanel = page.getByTestId('card-scanner-fields');
    await expect(fieldsPanel).toBeVisible();
    const fieldRows = await fieldsPanel.locator('[data-testid^="card-scanner-field-"]').count();
    expect(fieldRows).toBeGreaterThan(0);

    // Capture the OCR result for the assertion later
    const ocrSnapshot = {
      name: await page
        .getByTestId('card-scanner-field-姓名')
        .textContent()
        .catch(() => null),
      company: await page
        .getByTestId('card-scanner-field-公司')
        .textContent()
        .catch(() => null),
      title: await page
        .getByTestId('card-scanner-field-职位')
        .textContent()
        .catch(() => null),
      email: await page
        .getByTestId('card-scanner-field-邮箱')
        .textContent()
        .catch(() => null),
      phone: await page
        .getByTestId('card-scanner-field-电话')
        .textContent()
        .catch(() => null),
    };

    // 4. Click 应用到表单 to apply OCR fields
    await page.getByTestId('card-scanner-apply').click();

    // 5. Verify form fields are populated
    const nicknameInput = page.getByTestId('contact-nickname');
    await nicknameInput.fill('名片扫描测试');

    if (ocrSnapshot.name) {
      const nameValue = await page.getByTestId('contact-name').inputValue();
      expect(nameValue).toBeTruthy();
    }
    if (ocrSnapshot.company) {
      const companyValue = await page.getByTestId('contact-company').inputValue();
      expect(companyValue).toBeTruthy();
    }
    if (ocrSnapshot.email) {
      const emailValue = await page.getByTestId('contact-email').inputValue();
      expect(emailValue).toMatch(/.+@.+/);
    }
    if (ocrSnapshot.phone) {
      const phoneValue = await page.getByTestId('contact-phone').inputValue();
      expect(phoneValue).toMatch(/\d/);
    }

    // 6. Submit the form
    await page.getByTestId('contact-submit').click();

    // 7. Should navigate to /contacts/:id
    await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: 10_000 });
    const contactUrl = page.url();
    const contactId = contactUrl.match(/\/contacts\/([^/?#]+)/)?.[1];
    expect(contactId).toBeTruthy();

    // 8. Verify the contact exists on the server
    const verifyResp = await api.get(`${SERVER_BASE}/api/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(verifyResp.ok()).toBeTruthy();
    const contact = await verifyResp.json();
    expect(contact.id).toBe(contactId);
    expect(contact.nickname).toBe('名片扫描测试');

    await api.dispose();
  });
});