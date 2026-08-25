import { test, expect, request } from '@playwright/test';

const SERVER = 'http://localhost:3000';
const SPA = 'http://127.0.0.1:5181';

async function register(api: Awaited<ReturnType<typeof request.newContext>>, email: string, password: string) {
  const r = await api.post('/api/auth/register', {
    data: {
      email, password,
      display_name: email.split('@')[0],
      device: {
        install_id: `scroll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        app_version: '1.0.0', os: 'test', platform: 'web', name: 'scroll-test',
      },
    },
  });
  return r.json();
}

async function createContacts(api: Awaited<ReturnType<typeof request.newContext>>, token: string, userId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await api.post('/api/contacts', {
      headers: { Authorization: `Bearer ${token}` },
      data: { user_id: userId, nickname: `联系人${i}`, name: `Contact ${i}` },
    });
  }
}

async function createNotes(api: Awaited<ReturnType<typeof request.newContext>>, token: string, count: number) {
  for (let i = 0; i < count; i++) {
    await api.post('/api/notes', {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: `笔记${i}`, body: `内容 ${i}` },
    });
  }
}

test.describe('Infinite scroll', () => {
  test('contacts: scroll + button, no jump, no duplicates', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER });
    const stamp = Date.now();
    const sess = await register(api, `isc-${stamp}@local`, 'TestPass123!');
    await createContacts(api, sess.access_token, sess.user_id, 50);

    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript((s) => {
      localStorage.setItem('weavine.access_token', s.token);
      localStorage.setItem('weavine.refresh_token', s.refresh);
      localStorage.setItem('weavine.user_id', s.uid);
    }, { token: sess.access_token, refresh: 'x', uid: sess.user_id });

    const page = await ctx.newPage();
    await page.goto(`${SPA}/contacts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const initial = await page.locator('.row-card').count();
    expect(initial).toBe(20);

    // Scroll .app-shell__main to bottom → sentinel triggers
    await page.evaluate(() => {
      const m = document.querySelector('.app-shell__main');
      if (m) m.scrollTop = m.scrollHeight;
    });
    await page.waitForTimeout(2000);
    const afterScroll = await page.locator('.row-card').count();
    expect(afterScroll).toBeGreaterThan(20);

    // Click button
    const btn = page.locator('button:has-text("加载更多")');
    if (await btn.isVisible()) {
      const scrollBefore = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : 0;
      });
      await btn.click();
      await page.waitForTimeout(2000);
      const afterClick = await page.locator('.row-card').count();
      const scrollAfter = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : 0;
      });
      expect(scrollAfter).toBeGreaterThan(scrollBefore - 50);
      expect(afterClick).toBeGreaterThan(afterScroll);
    }

    // Dedup
    const names = await page.locator('.row-card__title').allTextContents();
    expect(new Set(names).size).toBe(names.length);
    console.log(`contacts PASS: ${names.length} unique`);
    await ctx.close();
    await api.dispose();
  });

  test('notes: scroll + button, no jump', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER });
    const stamp = Date.now();
    const sess = await register(api, `isn-${stamp}@local`, 'TestPass123!');
    await createNotes(api, sess.access_token, 30);

    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript((s) => {
      localStorage.setItem('weavine.access_token', s.token);
      localStorage.setItem('weavine.refresh_token', s.refresh);
      localStorage.setItem('weavine.user_id', s.uid);
    }, { token: sess.access_token, refresh: 'x', uid: sess.user_id });

    const page = await ctx.newPage();
    await page.goto(`${SPA}/notes`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const initial = await page.locator('.notes-list__item').count();
    expect(initial).toBeGreaterThanOrEqual(1);

    // Scroll — notes page might use window or .app-shell__main
    await page.evaluate(() => {
      const m = document.querySelector('.app-shell__main');
      if (m && m.scrollHeight > m.clientHeight) m.scrollTop = m.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(2000);
    const afterScroll = await page.locator('.notes-list__item').count();

    // Click button
    const btn = page.locator('button:has-text("加载更多")');
    if (await btn.isVisible()) {
      const scrollBefore = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : window.scrollY;
      });
      await btn.click();
      await page.waitForTimeout(2000);
      const afterClick = await page.locator('.notes-list__item').count();
      const scrollAfter = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : window.scrollY;
      });
      expect(scrollAfter).toBeGreaterThan(scrollBefore - 50);
      expect(afterClick).toBeGreaterThanOrEqual(afterScroll);
    }

    // Dedup
    const hrefs = await page.locator('.notes-list__item a').evaluateAll((els) =>
      els.map((el) => el.getAttribute('href')),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
    console.log(`notes PASS: ${hrefs.length} unique`);
    await ctx.close();
    await api.dispose();
  });
});
