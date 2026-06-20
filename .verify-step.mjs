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

const now = new Date();
const expectedHour = now.getHours();
const expectedMinute = Math.floor(now.getMinutes() / 15) * 15;

const initialState = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
}));
console.log('Initial state (should be empty):', initialState);

await page.click('button[aria-label="打开日期时间选择器"]');
await page.waitForTimeout(300);
const afterClick = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
console.log('After picker click (fresh):', afterClick);
const parsed = afterClick.startAt ? new Date(afterClick.startAt) : null;
if (parsed) {
  console.log(`  actual hour=${parsed.getHours()}, minute=${parsed.getMinutes()}`);
  console.log(`  expected hour=${expectedHour}, expected minute=${expectedMinute}`);
  console.log(`  ${parsed.getHours() === expectedHour ? 'HOUR MATCH' : 'HOUR MISMATCH'}`);
  console.log(`  ${parsed.getMinutes() === expectedMinute ? 'MINUTE MATCH' : 'MINUTE DIFF'}`);
  console.log(`  ${parsed.getMinutes() % 15 === 0 ? 'MINUTE ON STEP' : 'MINUTE NOT ON STEP'}`);
}

const stepAttr = await page.evaluate(() => document.querySelector('input[name="startAt"]').step);
console.log('\nstep attribute:', JSON.stringify(stepAttr), stepAttr === '900' ? 'PASS' : 'FAIL');

await page.screenshot({ path: '/tmp/opencode/local-form-step.png', fullPage: true });

await browser.close();
console.log('DONE');
