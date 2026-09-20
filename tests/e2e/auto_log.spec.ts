import { test, expect, request, type APIRequestContext } from '@playwright/test';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://127.0.0.1:13002';
const SPA_BASE = 'http://127.0.0.1:5181';

interface AuthSession {
  user_id: string;
  access_token: string;
}

let api: APIRequestContext | null = null;
let session: AuthSession | null = null;

test.describe('auto-log', () => {
  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: SERVER_BASE });
    // register-or-login: the account may not exist on a fresh local DB
    const creds = {
      email: 'qa-auto-log@example.com',
      password: 'testpass123',
      device: { name: 'qa-test', os: 'linux', app_version: '1.0.19' },
    };
    let resp = await api!.post('/api/auth/register', { data: creds });
    if (!resp.ok()) resp = await api!.post('/api/auth/login', { data: creds });
    if (!resp.ok()) throw new Error(`auto_log auth failed: ${resp.status()} ${await resp.text()}`);
    const body = await resp.json() as any;
    session = { user_id: body.user_id, access_token: body.access_token };
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test('shows 📅 来自日程 tag for event-source interactions on Today page', async ({ page }) => {
    test.skip(!session || !api, 'skip: no session');
    
    // Fetch interactions via API to verify data exists
    const resp = await api!.get('/api/interactions', {
      params: { user_id: session!.user_id, limit: '20' },
      headers: { Authorization: `Bearer ${session!.access_token}` },
    });
    const interactions = await resp.json() as any[];
    const eventInteractions = interactions.filter((i: any) => i.source === 'event');
    
    // Set auth cookie for browser
    await page.context().addCookies([{
      name: 'auth-token',
      value: session!.access_token,
      domain: '127.0.0.1',
      path: '/',
      secure: false,
      httpOnly: false,
    }]);
    
    await page.goto(`${SPA_BASE}/#/today`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/tmp/auto_log_today_final.png', fullPage: true });
    
    const tagCount = await page.locator('text=📅 来自日程').count();
    console.log('📅 来自日程 tags found in UI:', tagCount);
    console.log('Event-source interactions from API:', eventInteractions.length);
    for (const i of eventInteractions) {
      console.log(`  - ${i.summary} | contact=${i.contact_nickname} | ref=${String(i.source_ref)?.slice(0,8)}`);
    }
    
    if (eventInteractions.length > 0) {
      expect(tagCount).toBeGreaterThanOrEqual(1);
    }
  });
});
