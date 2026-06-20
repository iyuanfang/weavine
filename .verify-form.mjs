import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/home/yf/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('http://localhost:3100/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'pesome@gmail.com');
await page.fill('input[name="password"]', 'test1234');
await Promise.all([
  page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 10000 }),
  page.click('button[type="submit"]'),
]);

await page.goto('http://localhost:3100/events/new', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="startText"]');

// Test 1: empty
await page.screenshot({ path: '/tmp/opencode/local-form-empty.png', fullPage: true });

// Test 2: NL filled
await page.fill('input[name="startText"]', '明天下午3点');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/opencode/local-form-nl.png', fullPage: true });

// Test 3: NL with endAt set
await page.fill('input[name="endAt"]', '2026-06-20T17:00');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/opencode/local-form-with-end.png', fullPage: true });

// Test 4: complex NL
await page.fill('input[name="startText"]', '下周三晚上7点半');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/opencode/local-form-complex.png', fullPage: true });

console.log('screenshots: empty / nl / with-end / complex');
await browser.close();
