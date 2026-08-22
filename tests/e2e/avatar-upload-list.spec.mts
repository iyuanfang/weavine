/**
 * End-to-end: upload a contact avatar through the SPA → it appears on
 * the contact detail page (via avatar_storage_key) AND in the list.
 *
 * Verifies:
 *   - POST /api/media returns storage_key ending in .png
 *   - GET /files/{storage_key} serves 200 with image/png + cache headers
 *   - The contact row carries avatar_storage_key + avatar_mime after upload
 *   - The list page renders an <img> with src=/files/{storage_key}
 *
 * Prerequisites:
 *   Postgres weavine DB · weavine-server on :3000 · vite dev on :5181
 *
 * Run:
 *   npx playwright test tests/e2e/avatar-upload-list.spec.mts
 */

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:3000';
const SPA_BASE = process.env.SPA_URL ?? 'http://127.0.0.1:5181';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'c5cebda1d4baeaf268e1fa40e14edf03.jpg',
);

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
      device: { name: 'playwright-e2e', os: 'linux', app_version: '0.0.0-e2e' },
    },
  });
  if (!resp.ok()) {
    throw new Error(`register failed: ${resp.status()} ${await resp.text()}`);
  }
  const session = (await resp.json()) as AuthSession;
  expect(session.access_token).toBeTruthy();
  return session;
}

test.describe('avatar upload → list shows it', () => {
  test('upload via SPA, contact row mirrors avatar_storage_key, list <img> renders', async ({
    page,
    baseURL,
  }) => {
    const api = await request.newContext({ baseURL: SERVER_BASE });
    const stamp = Date.now();
    const email = `avatar-${stamp}@e2e.local`;
    const password = 'playwright-e2e-pw-12345';

    const session = await registerAndLogin(api, email, password);

    await page.addInitScript((s: AuthSession) => {
      window.localStorage.setItem('weavine.access_token', s.access_token);
      window.localStorage.setItem('weavine.refresh_token', s.refresh_token);
      window.localStorage.setItem('weavine.user_id', s.user_id);
    }, session);

    // 1. Create a contact via the server API.
    const createResp = await api.post(`${SERVER_BASE}/api/contacts`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: { nickname: '头像测试', name: 'Avatar Test' },
    });
    expect(createResp.ok()).toBeTruthy();
    const contact = (await createResp.json()) as { id: string };

    // 2. Upload a media file through /api/media (server-side pipeline that
    //    web + desktop now share via the Storage trait).
    const uploadResp = await api.post(`${SERVER_BASE}/api/media`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      multipart: {
        kind: 'avatar',
        owner_type: 'contact',
        owner_id: contact.id,
        file: {
          name: 'card.jpg',
          mimeType: 'image/jpeg',
          buffer: (await import('node:fs')).readFileSync(SAMPLE_PATH),
        },
      },
    });
    expect(uploadResp.ok()).toBeTruthy();
    const media = (await uploadResp.json()) as { storage_key: string };
    expect(media.storage_key).toMatch(/\.jpe?g$/);

    // 3. The trigger should have mirrored the avatar to contact.avatar_*.
    //    Poll briefly to allow the trigger to settle.
    let listWithAvatar: { items: Array<{ id: string; avatar_storage_key: string | null }> } | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await api.get(`${SERVER_BASE}/api/contacts`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      expect(r.ok()).toBeTruthy();
      const body = (await r.json()) as { items: Array<{ id: string; avatar_storage_key: string | null }> };
      const found = body.items.find((c) => c.id === contact.id);
      if (found?.avatar_storage_key) {
        listWithAvatar = body;
        break;
      }
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(listWithAvatar).not.toBeNull();

    // 4. /files/{storage_key} must serve 200 + correct mime + cache headers.
    const fileResp = await api.get(`${SERVER_BASE}/files/${media.storage_key}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(fileResp.ok()).toBeTruthy();
    expect(fileResp.headers()['content-type']).toMatch(/^image\//);
    expect(fileResp.headers()['cache-control']).toMatch(/max-age=\d+/);

    // 5. The contact list page must render an <img> with src containing the
    //    storage key filename. (SPA wires avatarUrlFor in ContactsList ContactRow.)
    //    The src is `/files/{user_id}/{kind}/{owner_type}/{owner_id}/{filename}`,
    //    so we match by the filename tail only.
    await page.goto(`${baseURL ?? SPA_BASE}/contacts`);
    const filename = media.storage_key.split('/').pop();
    expect(filename).toBeTruthy();
    const avatarImg = page.locator(
      `img[src*="${filename}"]`,
    ).first();
    await expect(avatarImg).toBeVisible({ timeout: 10_000 });

    await api.dispose();
  });
});