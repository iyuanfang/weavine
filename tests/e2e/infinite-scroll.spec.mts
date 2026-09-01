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
  // Create in batches of 10 for speed
  for (let i = 0; i < count; i += 10) {
    const batch = Math.min(10, count - i);
    await Promise.all(
      Array.from({ length: batch }, (_, j) =>
        api.post('/api/contacts', {
          headers: { Authorization: `Bearer ${token}` },
          data: { user_id: userId, nickname: `联系人${i + j}`, name: `Contact ${i + j}` },
        }),
      ),
    );
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

async function getScrollState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const m = document.querySelector('.app-shell__main');
    return {
      scrollTop: m ? m.scrollTop : window.scrollY,
      scrollHeight: m ? m.scrollHeight : document.body.scrollHeight,
      clientHeight: m ? m.clientHeight : window.innerHeight,
      items: document.querySelectorAll('.row-card').length,
    };
  });
}

async function scrollToBottom(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const m = document.querySelector('.app-shell__main');
    if (m) m.scrollTop = m.scrollHeight;
  });
}

test.describe('Infinite scroll', () => {
  test('contacts: 120 items, scroll+button, no jump on first load', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER });
    const stamp = Date.now();
    const sess = await register(api, `isc-${stamp}@local`, 'TestPass123!');
    await createContacts(api, sess.access_token, sess.user_id, 120);

    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript((s) => {
      localStorage.setItem('weavine.access_token', s.token);
      localStorage.setItem('weavine.refresh_token', s.refresh);
      localStorage.setItem('weavine.user_id', s.uid);
    }, { token: sess.access_token, refresh: 'x', uid: sess.user_id });

    const page = await ctx.newPage();
    await page.goto(`${SPA}/contacts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Initial: should have 20 contacts
    const initial = await page.locator('.row-card').count();
    console.log(`initial contacts: ${initial}`);
    expect(initial).toBe(20);

    // Scroll down in the scroll container (.app-shell__main)
    const before = await getScrollState(page);
    console.log('before scroll:', JSON.stringify(before));

    // Scroll the .app-shell__main container to bottom
    await scrollToBottom(page);
    await page.waitForTimeout(1500);

    const after = await getScrollState(page);
    console.log('after scroll:', JSON.stringify(after));

    // KEY CHECK: scroll position should NOT be near 0
    // The bug is: isLoading replaces the list, content shrinks, scrollTop resets to 0
    if (after.scrollTop < 10 && after.scrollHeight > before.scrollHeight) {
      // This means the content grew (more items loaded) but scroll jumped to top
      throw new Error(
        `SCROLL JUMP DETECTED: scrollTop ${after.scrollTop} after scroll+fetch (was ${before.scrollTop}). ` +
        `Content grew from ${before.scrollHeight} to ${after.scrollHeight}px. ` +
        `This means isLoading replaced the DOM during fetch.`
      );
    }

    // Items should have increased
    console.log(`items: ${initial} → ${after.items}`);
    expect(after.items).toBeGreaterThan(initial);

    // Scroll again — should still work, no jump
    const before2 = await getScrollState(page);
    await scrollToBottom(page);
    await page.waitForTimeout(1500);
    const after2 = await getScrollState(page);
    console.log('after 2nd scroll:', JSON.stringify(after2));
    expect(after2.items).toBeGreaterThan(after.items);

    // Dedup check
    const names = await page.locator('.row-card__title').allTextContents();
    expect(new Set(names).size).toBe(names.length);
    console.log(`contacts PASS: ${names.length} unique`);

    await ctx.close();
    await api.dispose();
  });

  test('notes: 60 items, scroll+button, no jump', async ({ browser }) => {
    const api = await request.newContext({ baseURL: SERVER });
    const stamp = Date.now();
    const sess = await register(api, `isn-${stamp}@local`, 'TestPass123!');
    await createNotes(api, sess.access_token, 60);

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
    console.log(`initial notes: ${initial}`);
    expect(initial).toBeGreaterThanOrEqual(1);

    // Scroll
    await page.evaluate(() => {
      const m = document.querySelector('.app-shell__main');
      if (m && m.scrollHeight > m.clientHeight) m.scrollTop = m.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1500);
    const afterScroll = await page.locator('.notes-list__item').count();
    console.log(`notes after scroll: ${afterScroll}`);

    // Button
    const btn = page.locator('button:has-text("加载更多")');
    if (await btn.isVisible()) {
      const scrollBefore = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : window.scrollY;
      });
      await btn.click();
      await page.waitForTimeout(1500);
      const afterClick = await page.locator('.notes-list__item').count();
      const scrollAfter = await page.evaluate(() => {
        const m = document.querySelector('.app-shell__main');
        return m ? m.scrollTop : window.scrollY;
      });
      console.log(`button click: ${scrollBefore} → ${scrollAfter}, items ${afterScroll} → ${afterClick}`);
      // Scroll should not jump to 0 after button click
      if (scrollAfter < 10 && afterClick > afterScroll) {
        throw new Error(`NOTES SCROLL JUMP: scrollTop ${scrollAfter} after button click (was ${scrollBefore})`);
      }
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
