import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (n, ok, x) => { (ok ? pass++ : fail++); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${x ? ` — ${x}` : ''}`); };

// 1. Login as pesome (existing user with data)
await page.goto(`${URL}/login`);
await page.locator('input[name="email"]').fill('pesome@gmail.com');
await page.locator('input[name="password"]').fill('12345678');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
check('login', !page.url().includes('/login'), `url=${page.url()}`);

// 2. Verify 3 sections exist
const sections = await page.locator('main.today-page section').count();
check('3 sections rendered', sections === 3, `count=${sections}`);

// 3. Section headers (titles)
const h2Texts = await page.locator('main.today-page section h2').allTextContents();
check('section 1 = 今日要做', h2Texts[0]?.includes('今日要做') ?? false, `h2[0]=${h2Texts[0]}`);
check('section 2 = 未来 3 天日程', h2Texts[1]?.includes('未来 3 天日程') ?? false, `h2[1]=${h2Texts[1]}`);
check('section 3 = 近期互动', h2Texts[2]?.includes('近期互动') ?? false, `h2[2]=${h2Texts[2]}`);

// 4. No KPI cards
const kpi = await page.locator('.kpi-row').count();
check('no KPI cards', kpi === 0, `count=${kpi}`);

// 5. No 建议先做, 收件箱, 待排期 sections
const html = await page.content();
check('no 建议先做 section', !html.includes('建议先做'));
check('no 收件箱 section', !html.includes('收件箱'));
check('no 待排期 section', !html.includes('待排期'));

// 6. No QuickAddBar (新建待办)
const quickAdd = await page.locator('button:has-text("+ 新建待办")').count();
check('no QuickAddBar', quickAdd === 0);

// 7. No focusedToday / topSuggestions old class names
check('no focusedToday in HTML', !html.includes('focusedToday'));
check('no topSuggestions text', !html.includes('topSuggestions'));

// 8. View-all links present
const viewAllLinks = await page.locator('a:has-text("全部")').count();
check('view-all links (3)', viewAllLinks === 3, `count=${viewAllLinks}`);

// 9. Today has actual data — pesome has 2 inbox actions due this weekend
const todayRows = await page.locator('[data-testid="action-row"]').count();
check('has 今日要做 rows', todayRows >= 1, `count=${todayRows}`);

// 10. Interaction list shows up
const interactionRows = await page.locator('main.today-page section').nth(2).locator('a').count();
check('recent interactions rendered', interactionRows >= 1, `count=${interactionRows}`);

// 11. CSS stagger animation still defined
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

// 12. Subtitle format includes "已过期" or "今天"
if (todayRows > 0) {
  const subtitle = await page.locator('[data-testid="action-row"]').first().innerText();
  check('row subtitle includes date hint', subtitle.includes('已过期') || subtitle.includes('今天'), `text=${subtitle.replace(/\s+/g, ' ').slice(0, 80)}`);
}

await page.screenshot({ path: '/tmp/opencode/today-3sections.png', fullPage: true });
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);