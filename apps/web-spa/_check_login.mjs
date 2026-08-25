import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 150)));
page.on('response', async (resp) => {
  const u = resp.url();
  if (u.includes('localhost:3000/api/')) {
    console.log(`[resp ${resp.status()}] ${resp.request().method()} ${u.replace('http://localhost:3000','')}`);
  }
});

await page.goto('http://127.0.0.1:5181/login');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(500);

// Click "register" toggle
await page.locator('button:has-text("注册"), a:has-text("注册"), [role=tab]:has-text("注册")').first().click().catch(() => {});
await page.waitForTimeout(300);

const emailInput = page.locator('input[type=email], input[name=email]').first();
const pwInput = page.locator('input[type=password]').first();

const ts = Date.now();
const email = `check-${ts}@local`;
await emailInput.fill(email);
await pwInput.fill('TestPass123!');
console.log('filled form');

const submitBtn = page.locator('button[type=submit]').first();
await submitBtn.click();
await page.waitForTimeout(2500);

const ls = await page.evaluate(() => ({
  token: !!localStorage.getItem('weavine.access_token'),
  uid: localStorage.getItem('weavine.user_id'),
  email: localStorage.getItem('weavine.email'),
  url: location.href
}));
console.log('[after login]', ls);

if (ls.url.includes('/login')) {
  console.log('LOGIN FAILED');
  const errText = await page.locator('.error, [class*="error"]').allInnerTexts().catch(() => []);
  console.log('errors:', errText);
  await browser.close();
  process.exit(1);
}

// Now go to /notes
await page.goto('http://127.0.0.1:5181/notes');
await page.waitForTimeout(2500);

const html = await page.locator('.page').innerHTML().catch(() => '(none)');
console.log('\n[/notes page html[:2000]]');
console.log(html.slice(0, 2000));

await browser.close();
