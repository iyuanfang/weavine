import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });

const regResp = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    email: `debug-scroll2-${Date.now()}@local`, password: 'TestPass123!',
    display_name: 'debug', device: { install_id: `dbg2-${Date.now()}`, app_version: '1.0.0', os: 'test', platform: 'web', name: 'dbg2' }
  })
});
const sess = await regResp.json();

for (let i = 0; i < 50; i++) {
  await fetch('http://localhost:3000/api/contacts', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${sess.access_token}`},
    body: JSON.stringify({ user_id: sess.user_id, nickname: `联系人${i}` })
  });
}
console.log('created 50 contacts');

await ctx.addInitScript((s) => {
  localStorage.setItem('weavine.access_token', s.token);
  localStorage.setItem('weavine.refresh_token', s.refresh);
  localStorage.setItem('weavine.user_id', s.uid);
}, { token: sess.access_token, refresh: 'x', uid: sess.user_id });

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5181/contacts', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const count1 = await page.locator('.row-card').count();
console.log('[initial]', count1, 'contacts');

// Check scroll container
const scrollInfo = await page.evaluate(() => {
  const main = document.querySelector('.app-shell__main');
  if (!main) return { found: false };
  return {
    found: true,
    scrollHeight: main.scrollHeight,
    clientHeight: main.clientHeight,
    scrollTop: main.scrollTop,
    overflowY: getComputedStyle(main).overflowY,
  };
});
console.log('[scroll container]', scrollInfo);

// Scroll the CORRECT container
await page.evaluate(() => {
  const main = document.querySelector('.app-shell__main');
  if (main) main.scrollTop = main.scrollHeight;
});
await page.waitForTimeout(2000);
const count2 = await page.locator('.row-card').count();
console.log('[after scroll]', count2, 'contacts');

// Click button if visible
const btn = page.locator('button:has-text("加载更多")');
if (await btn.isVisible()) {
  await btn.click();
  await page.waitForTimeout(2000);
  const count3 = await page.locator('.row-card').count();
  console.log('[after click]', count3, 'contacts');
}

await browser.close();
