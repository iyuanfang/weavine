import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));

// Listen to /api/notes responses
page.on('response', async (resp) => {
  if (resp.url().includes('/api/notes')) {
    const status = resp.status();
    const ct = resp.headers()['content-type'] || '';
    let body = '';
    try { body = await resp.text(); } catch {}
    console.log(`[notes resp] ${status} ${ct}`);
    console.log(`  url: ${resp.url()}`);
    console.log(`  body[:200]: ${body.slice(0, 200)}`);
  }
});

await page.goto('http://127.0.0.1:5181/login', { waitUntil: 'networkidle' });

// register
await page.locator('input[type=email]').fill('visual-debug@local');
await page.locator('input[type=password]').fill('TestPass123!');
await page.locator('button:has-text("注册")').first().click({ timeout: 3000 }).catch(async () => {
  // try login if already registered
  await page.locator('button:has-text("登录")').first().click();
});
await page.waitForLoadState('networkidle');

// now go to notes
await page.goto('http://127.0.0.1:5181/notes', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const html = await page.locator('main').innerHTML().catch(() => '(no main)');
console.log('[main html[:1500]]', html.slice(0, 1500));

const localStorage = await page.evaluate(() => JSON.stringify({
  token: localStorage.getItem('weavine.access_token')?.slice(0, 30),
  uid: localStorage.getItem('weavine.user_id'),
}));
console.log('[localStorage]', localStorage);

await browser.close();
