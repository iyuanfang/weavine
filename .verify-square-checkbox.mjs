import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (n, ok, x) => { (ok ? pass++ : fail++); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${x ? ` — ${x}` : ''}`); };

await page.goto(`${URL}/login`);
await page.locator('input[name="email"]').fill('pesome@gmail.com');
await page.locator('input[name="password"]').fill('12345678');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');

// 1. Square checkbox (border-radius: 4px, NOT 9999px / 50%)
const checkBtn = page.locator('.action-check').first();
const radius = await checkBtn.evaluate(el => getComputedStyle(el).borderRadius);
check('checkbox is square (rounded, not circle)', !radius.includes('9999') && !radius.includes('50%'), `radius=${radius}`);
const bgColor = await checkBtn.evaluate(el => getComputedStyle(el).backgroundColor);
check('checkbox has white bg', bgColor.includes('255, 255, 255') || bgColor.includes('rgb(255'), `bg=${bgColor}`);

// 2. View-all links no longer show numbers
const viewAllTexts = await page.locator('a:has-text("全部")').allTextContents();
check('view-all = "全部 →" (no count)', viewAllTexts.every(t => /^全部\s*→$/.test(t.trim())), `texts=${JSON.stringify(viewAllTexts)}`);
check('3 view-all links', viewAllTexts.length === 3, `count=${viewAllTexts.length}`);
check('no "(" in view-all', viewAllTexts.every(t => !t.includes('(')), `texts=${JSON.stringify(viewAllTexts)}`);

// 3. 3 sections still rendered
const sections = await page.locator('main.today-page section').count();
check('3 sections', sections === 3);

// 4. Click checkbox completes the action (animation should fire)
const rowsBefore = await page.locator('[data-testid="action-row"]').count();
if (rowsBefore > 0) {
  await page.locator('.action-check').first().click();
  await page.waitForTimeout(1500);
  const rowsAfter = await page.locator('[data-testid="action-row"]').count();
  check('complete via square checkbox works', rowsAfter < rowsBefore, `${rowsBefore}→${rowsAfter}`);
}

await page.screenshot({ path: '/tmp/opencode/today-square-checkbox.png', fullPage: true });
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);