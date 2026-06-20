import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (n, ok, x) => { (ok ? pass++ : fail++); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${x ? ` — ${x}` : ''}`); };

// 1. Sign up
const email = `smart-${Date.now()}@test.local`;
await page.goto(`${URL}/sign-up`);
await page.locator('input[name="email"]').fill(email);
await page.locator('input[name="password"]').fill('test1234');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
check('signup', !page.url().includes('/sign-up'), `url=${page.url()}`);

// 2. Today page should have no focusedToday refs
const html = await page.content();
check('no focusedToday in HTML', !html.includes('focusedToday'));

// 3. CSS animation still defined
const animDefined = await page.evaluate(() => {
  for (const s of document.styleSheets) {
    try {
      for (const r of s.cssRules) {
        if (r.cssText && r.cssText.includes('today-fade-in-up')) return true;
      }
    } catch {}
  }
  return false;
});
check('today-fade-in-up animation defined', animDefined);

const reducedMotionRule = await page.evaluate(() => {
  for (const s of document.styleSheets) {
    try {
      for (const r of s.cssRules) {
        if (r.cssText && r.cssText.includes('prefers-reduced-motion')) return true;
      }
    } catch {}
  }
  return false;
});
check('prefers-reduced-motion respected', reducedMotionRule);

// 4. today-page class present
const mainClass = await page.locator('main').first().getAttribute('class');
check('today-page class on main', mainClass?.includes('today-page') ?? false, `class=${mainClass?.slice(0, 60)}`);

// 5. Quick-add: open form, fill, submit. Wait for row to appear in DOM.
await page.locator('button:has-text("+ 新建待办")').click();
await page.waitForTimeout(300);
await page.locator('input[placeholder="待办标题…"]').fill('跟 Bob 聊合同');
await page.locator('button:has-text("保存")').click();
// Wait for the row to appear (up to 5s)
try {
  await page.waitForSelector('[data-testid="action-row"]', { timeout: 5000 });
} catch (e) { /* counted below */ }
const rowsAfter1 = await page.locator('[data-testid="action-row"]').count();
check('quick-add creates 1 action row', rowsAfter1 >= 1, `count=${rowsAfter1}`);

// 6. Top suggestions section visible (the action with due-date should appear)
const topSection = await page.locator('h2:has-text("建议先做")').count();
check('"建议先做" section exists', topSection === 1);

// 7. No "今日聚焦" (the old name) anywhere
const oldFocusName = await page.locator('h2:has-text("今日聚焦")').count();
check('no old "今日聚焦" section', oldFocusName === 0);

// 8. Complete button works (animation finishes, count decreases)
await page.waitForTimeout(500);
const before = await page.locator('[data-testid="action-row"]').count();
if (before > 0) {
  await page.locator('.action-check').first().click();
  await page.waitForTimeout(1500);
}
const after = await page.locator('[data-testid="action-row"]').count();
check('complete removes row', after < before, `${before}→${after}`);

await page.screenshot({ path: '/tmp/opencode/smart-top5.png', fullPage: true });
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);