import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (n, ok, x) => { (ok ? pass++ : fail++); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${x ? ` — ${x}` : ''}`); };

// 1. Sign up
const email = `focus-${Date.now()}@test.local`;
await page.goto(`${URL}/sign-up`);
await page.locator('input[name="email"]').fill(email);
await page.locator('input[name="password"]').fill('test1234');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
check('signup', !page.url().includes('/sign-up'), `url=${page.url()}`);

// 2. Create some actions via quick-add
await page.waitForSelector('button:has-text("+ 新建待办")', { timeout: 5000 });
for (const title of ['跟 Bob 聊合同', '准备周五演示', '回复 Alice 邮件', '整理 PRM 笔记']) {
  await page.locator('button:has-text("+ 新建待办")').click();
  await page.locator('input[placeholder="待办标题…"]').fill(title);
  await page.locator('button:has-text("保存")').click();
  await page.waitForTimeout(400);
}
const inboxCount = await page.locator('[data-testid="action-row"]').count();
check('quick-add creates actions', inboxCount >= 4, `count=${inboxCount}`);

// 3. Focus (star) first 2 actions
const starButtons = page.locator('button[aria-label="聚焦今日"]');
const n = Math.min(2, await starButtons.count());
for (let i = 0; i < n; i++) {
  await starButtons.nth(0).click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
const focusedSection = await page.locator('h2:has-text("今日聚焦")').count();
check('focused section appears', focusedSection === 1);
const focusedItems = await page.locator('[data-focused="true"]').count();
check('items marked focused', focusedItems >= 2, `count=${focusedItems}`);

// 4. Complete an action via check button
const initialRows = await page.locator('[data-testid="action-row"]').count();
await page.locator('.action-check').first().click();
await page.waitForTimeout(900);
const afterRows = await page.locator('[data-testid="action-row"]').count();
check('complete removes row', afterRows < initialRows, `${initialRows}→${afterRows}`);

// 5. Animations: confirm CSS classes are emitted
await page.waitForTimeout(500);
const todayPageClass = await page.locator('main').first().getAttribute('class');
check('today-page class on main', todayPageClass?.includes('today-page') ?? false, `class=${todayPageClass?.slice(0, 60)}`);
const staggerRule = await page.evaluate(() => {
  const sheets = [...document.styleSheets];
  for (const s of sheets) {
    try {
      for (const r of s.cssRules) {
        if (r.cssText && r.cssText.includes('today-fade-in-up')) return true;
      }
    } catch {}
  }
  return false;
});
check('today-fade-in-up keyframe defined', staggerRule);

const reducedMotionRule = await page.evaluate(() => {
  const sheets = [...document.styleSheets];
  for (const s of sheets) {
    try {
      for (const r of s.cssRules) {
        if (r.cssText && r.cssText.includes('prefers-reduced-motion')) return true;
      }
    } catch {}
  }
  return false;
});
check('prefers-reduced-motion respected', reducedMotionRule);

await page.screenshot({ path: '/tmp/opencode/today-ritual.png', fullPage: true });
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);