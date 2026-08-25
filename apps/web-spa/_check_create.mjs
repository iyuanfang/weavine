import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 150)));
page.on('response', async (resp) => {
  const u = resp.url();
  if (u.includes('localhost:3000/api/notes')) {
    console.log(`[notes ${resp.status()}] ${resp.request().method()} ${u.replace('http://localhost:3000','')}`);
  }
});

// Login flow
await page.goto('http://127.0.0.1:5181/login');
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(500);
await page.locator('button:has-text("注册"), a:has-text("注册"), [role=tab]:has-text("注册")').first().click().catch(() => {});
await page.waitForTimeout(300);
const ts = Date.now();
await page.locator('input[type=email]').first().fill(`create-${ts}@local`);
await page.locator('input[type=password]').first().fill('TestPass123!');
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(2500);

// Go to /notes
await page.goto('http://127.0.0.1:5181/notes');
await page.waitForTimeout(1500);

// Click 新建笔记 button (in header)
await page.locator('.page-header button:has-text("新建笔记")').first().click();
await page.waitForTimeout(1500);

// Type title
await page.locator('input.note-edit__title').fill('测试笔记 A');
// Type body
await page.locator('.cm-content').click();
await page.locator('.cm-content').type('# Hello\n\n这是测试内容');

await page.waitForTimeout(500);

// Click 保存
await page.locator('button:has-text("保存")').first().click();
await page.waitForTimeout(2000);

const url1 = page.url();
console.log('[after save url]', url1);

// Go back to /notes
await page.goto('http://127.0.0.1:5181/notes');
await page.waitForTimeout(2000);

const html = await page.locator('.page').innerHTML();
console.log('\n[/notes html after create]');
console.log(html.slice(0, 2500));

await browser.close();
