import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:5181/login');
await page.waitForLoadState('domcontentloaded');
await page.locator('button:has-text("注册")').first().click().catch(() => {});
await page.waitForTimeout(300);
const ts = Date.now();
await page.locator('input[type=email]').first().fill(`cl-${ts}@local`);
await page.locator('input[type=password]').first().fill('TestPass123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);
const token = await page.evaluate(() => localStorage.getItem('weavine.access_token'));

const promises = [];
for (let i = 0; i < 60; i++) {
  promises.push(fetch('http://localhost:3000/api/contacts', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body: JSON.stringify({nickname: `列表测试 #${i+1}`, importance: 'medium'})
  }));
}
await Promise.all(promises);
console.log('created 60 contacts');

await page.goto('http://127.0.0.1:5181/contacts');
await page.waitForTimeout(2000);

let count = await page.locator('.row-card').count();
console.log(`[initial] ${count}`);

// Click "加载更多" button
const loadMore = page.locator('button:has-text("加载更多")');
console.log(`[load-more visible] ${await loadMore.isVisible()}`);
await loadMore.click();
await page.waitForTimeout(1500);

count = await page.locator('.row-card').count();
console.log(`[after 1 click] ${count}`);

await loadMore.click();
await page.waitForTimeout(1500);
count = await page.locator('.row-card').count();
console.log(`[after 2 clicks] ${count}`);

await loadMore.click();
await page.waitForTimeout(1500);
count = await page.locator('.row-card').count();
console.log(`[after 3 clicks] ${count}`);

// Check for duplicates
const names = await page.locator('.row-card__title').allInnerTexts();
const unique = new Set(names);
console.log(`[total] ${names.length} [unique] ${unique.size} [dups] ${names.length - unique.size}`);

await browser.close();
