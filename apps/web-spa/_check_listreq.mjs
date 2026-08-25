import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 100)));
page.on('request', r => {
  if (r.url().includes('localhost:3000/api/')) {
    console.log(`[req] ${r.method()} ${r.url().replace('http://localhost:3000','')}`);
  }
});
page.on('response', r => {
  if (r.url().includes('localhost:3000/api/')) {
    console.log(`[resp ${r.status()}] ${r.url().replace('http://localhost:3000','')}`);
  }
});

// Login flow
await page.goto('http://127.0.0.1:5181/login');
await page.waitForLoadState('domcontentloaded');
await page.locator('button:has-text("注册"), a:has-text("注册"), [role=tab]:has-text("注册")').first().click().catch(() => {});
await page.waitForTimeout(300);
const ts = Date.now();
await page.locator('input[type=email]').first().fill(`lreq-${ts}@local`);
await page.locator('input[type=password]').first().fill('TestPass123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);

// Create a note via API directly
const token = await page.evaluate(() => localStorage.getItem('weavine.access_token'));
console.log('[token len]', token?.length);

await fetch('http://localhost:3000/api/notes', {
  method: 'POST',
  headers: {'Content-Type':'application/json','Authorization':`Bearer ${token}`},
  body: JSON.stringify({title: 'API created', body: '# api body'})
}).then(r => console.log('create via API:', r.status));

// Now go to /notes and wait
console.log('\n=== navigating to /notes ===');
await page.goto('http://127.0.0.1:5181/notes');
await page.waitForTimeout(3000);

const html = await page.locator('.page').innerHTML();
console.log('\n[.page html[:1500]]');
console.log(html.slice(0, 1500));

await browser.close();
