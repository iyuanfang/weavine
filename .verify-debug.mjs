// Debug why NL parse isn't triggering in playwright
import { chromium } from 'playwright';

const BASE = 'http://localhost:3100';

const browser = await chromium.launch({
  executablePath: '/home/yf/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', (msg) => console.log(`[${msg.type()}]`, msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'pesome@gmail.com');
await page.fill('input[name="password"]', 'test1234');
await Promise.all([
  page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 10000 }),
  page.click('button[type="submit"]'),
]);

await page.goto(`${BASE}/events/new`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="startText"]');

// Test parseDateNL directly in browser context
const directResult = await page.evaluate(() => {
  // We don't have direct access to the imported module. Let's just test chrono.
  // But better: dispatch a real input event and check if onChange fires.
  const el = document.querySelector('input[name="startText"]');
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(el, '明天下午3点');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { afterDispatch: el.value };
});
console.log('after dispatch:', directResult);

await page.waitForTimeout(500);
const state = await page.evaluate(() => {
  return {
    startText: document.querySelector('input[name="startText"]')?.value,
    startAt: document.querySelector('input[name="startAt"]')?.value,
    endAt: document.querySelector('input[name="endAt"]')?.value,
  };
});
console.log('final state:', state);

// Try with page.type (keyboard simulation)
console.log('\n--- type() test ---');
await page.fill('input[name="startText"]', '');
await page.type('input[name="startText"]', '明天下午3点', { delay: 30 });
await page.waitForTimeout(500);
const state2 = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]')?.value,
  startAt: document.querySelector('input[name="startAt"]')?.value,
  endAt: document.querySelector('input[name="endAt"]')?.value,
}));
console.log('after type:', state2);

await browser.close();