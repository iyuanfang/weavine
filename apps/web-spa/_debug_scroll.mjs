import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });

// Register
const regResp = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    email: `debug-scroll-${Date.now()}@local`, password: 'TestPass123!',
    display_name: 'debug', device: { install_id: `dbg-${Date.now()}`, app_version: '1.0.0', os: 'test', platform: 'web', name: 'dbg' }
  })
});
const sess = await regResp.json();

// Create 50 contacts
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
page.on('console', m => {
  if (m.type() === 'log' || m.type() === 'error') console.log(`[console ${m.type()}]`, m.text().slice(0, 200));
});

await page.goto('http://127.0.0.1:5181/contacts', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const count1 = await page.locator('.row-card').count();
console.log('[initial]', count1, 'contacts');

// Check page height and scroll
const height = await page.evaluate(() => document.body.scrollHeight);
const viewH = await page.evaluate(() => window.innerHeight);
console.log('[page] height:', height, 'viewport:', viewH);

// Scroll to bottom
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2000);
const count2 = await page.locator('.row-card').count();
console.log('[after scroll]', count2, 'contacts');

// Check if sentinel exists
const sentinelExists = await page.locator('div[style*="height: 1px"]').count();
console.log('[sentinel exists]', sentinelExists);

// Check hasMore state
const hasMoreBtn = await page.locator('button:has-text("加载更多")').isVisible().catch(() => false);
console.log('[button visible]', hasMoreBtn);

// Click button if visible
if (hasMoreBtn) {
  await page.locator('button:has-text("加载更多")').click();
  await page.waitForTimeout(2000);
  const count3 = await page.locator('.row-card').count();
  console.log('[after click]', count3, 'contacts');
}

await browser.close();
