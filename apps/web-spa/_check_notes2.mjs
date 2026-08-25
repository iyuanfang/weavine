import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();

// Set tokens via init script
const sess = {
  user_id: '3c374d8e-afb5-4488-99d2-b294a718580d',
  access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIzYzM3NGQ4ZS1hZmI1LTQ0ODgtOTlkMi1iMjk0YTcxODU4MGQiLCJlbWFp',
  refresh_token: 'placeholder',
};
await ctx.addInitScript((s) => {
  localStorage.setItem('weavine.access_token', s.access_token);
  localStorage.setItem('weavine.refresh_token', s.refresh_token);
  localStorage.setItem('weavine.user_id', s.user_id);
}, sess);

const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('response', async (resp) => {
  if (resp.url().includes('/api/notes')) {
    const status = resp.status();
    let body = '';
    try { body = await resp.text(); } catch {}
    console.log(`[notes resp] ${status}`);
    console.log(`  body[:300]: ${body.slice(0, 300)}`);
  }
});

await page.goto('http://127.0.0.1:5181/notes', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const html = await page.locator('.page').innerHTML().catch(() => '(no .page)');
console.log('[.page html[:2000]]', html.slice(0, 2000));

await browser.close();
