import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', m => {
  if (m.type() === 'error') console.log('[console err]', m.text().slice(0, 200));
});
page.on('response', r => {
  if (r.url().includes('localhost:3000/api/contacts')) {
    console.log(`[contacts ${r.status()}] ${r.url().slice(-40)}`);
  }
});

// Login
await page.goto('http://127.0.0.1:5181/login');
await page.waitForLoadState('domcontentloaded');
await page.locator('button:has-text("注册")').first().click().catch(() => {});
await page.waitForTimeout(300);
const ts = Date.now();
await page.locator('input[type=email]').first().fill(`scroll-${ts}@local`);
await page.locator('input[type=password]').first().fill('TestPass123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);

// Get token
const token = await page.evaluate(() => localStorage.getItem('weavine.access_token'));

// Create 50 contacts
console.log('creating 50 contacts...');
const promises = [];
for (let i = 0; i < 50; i++) {
  promises.push(fetch('http://localhost:3000/api/contacts', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body: JSON.stringify({nickname: `滚动测试 #${i+1}`, importance: 'medium'})
  }));
}
await Promise.all(promises);
console.log('done creating');

// Go to contacts
await page.goto('http://127.0.0.1:5181/contacts');
await page.waitForTimeout(3000);
  console.log('window.h=', await page.evaluate(() => ({sh: document.documentElement.scrollHeight, ih: window.innerHeight})).then(o => JSON.stringify(o)));

// Get initial count
let count = await page.locator('.row-card').count();
console.log(`\n[initial count] ${count}`);

// Scroll halfway
await page.evaluate(() => {
  const h = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, h * 0.3);
});
await page.waitForTimeout(1500);

count = await page.locator('.row-card').count();
const scrollY1 = await page.evaluate(() => window.scrollY);
console.log(`[after half scroll] count=${count} scrollY=${scrollY1}`);

await page.evaluate(() => {
  const h = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, h * 0.6);
});
await page.waitForTimeout(1500);

count = await page.locator('.row-card').count();
const scrollY2 = await page.evaluate(() => window.scrollY);
console.log(`[after 60% scroll] count=${count} scrollY=${scrollY2}`);

// Scroll to bottom
await page.evaluate(() => {
  const h = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, h);
});
await page.waitForTimeout(1500);

count = await page.locator('.row-card').count();
const scrollY3 = await page.evaluate(() => window.scrollY);
console.log(`[after bottom scroll] count=${count} scrollY=${scrollY3}`);

// Get all contact names + check duplicates
const names = await page.locator('.row-card__title').allInnerTexts();
const uniqueNames = new Set(names);
console.log(`[total items] ${names.length} [unique] ${uniqueNames.size}`);

await browser.close();
