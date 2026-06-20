// Verify merged NL+picker date input on /events/new
import { chromium } from 'playwright';

const BASE = 'http://localhost:3100';
const EMAIL = 'pesome@gmail.com';
const PASSWORD = 'test1234';

const browser = await chromium.launch({
  executablePath: '/home/yf/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('pageerror', (err) => console.log('[pageerror]', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});

// 1. Login
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 10000 }),
  page.click('button[type="submit"]'),
]);
console.log('login OK, landed on', page.url());

// 2. Go to /events/new
await page.goto(`${BASE}/events/new`, { waitUntil: "domcontentloaded" });
console.log('events/new URL:', page.url());

// 3. Inspect DOM
const counts = await page.evaluate(() => {
  const visibleStart = document.querySelector('input[name="startText"]');
  const hiddenStart = document.querySelector('input[name="startAt"]');
  const end = document.querySelector('input[name="endAt"]');
  const button = document.querySelector('button[aria-label="打开日期时间选择器"]');
  return {
    visibleStartType: visibleStart?.type,
    visibleStartName: visibleStart?.name,
    visibleStartPlaceholder: visibleStart?.placeholder,
    hiddenStartType: hiddenStart?.type,
    hiddenStartName: hiddenStart?.name,
    hiddenStartClass: hiddenStart?.className,
    endType: end?.type,
    endName: end?.name,
    buttonExists: !!button,
    buttonText: button?.textContent,
  };
});
console.log('DOM inspect:', JSON.stringify(counts, null, 2));

// 4. Test NL parsing
console.log('\n--- Test 1: "明天下午3点" ---');
await page.fill('input[name="startText"]', '明天下午3点');
await page.waitForTimeout(200);
let state = await page.evaluate(() => {
  const startText = document.querySelector('input[name="startText"]').value;
  const startAt = document.querySelector('input[name="startAt"]').value;
  const endAt = document.querySelector('input[name="endAt"]').value;
  return { startText, startAt, endAt };
});
console.log('result:', state);

console.log('\n--- Test 2: clear and "周六上午10点" ---');
await page.fill('input[name="startText"]', '周六上午10点');
await page.waitForTimeout(200);
state = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
console.log('result:', state);

console.log('\n--- Test 3: clear and "下周三晚上7点半" ---');
await page.fill('input[name="startText"]', '下周三晚上7点半');
await page.waitForTimeout(200);
state = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
console.log('result:', state);

console.log('\n--- Test 4: explicit "2026-06-25 14:30" ---');
await page.fill('input[name="startText"]', '2026-06-25 14:30');
await page.waitForTimeout(200);
state = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
console.log('result:', state);

console.log('\n--- Test 5: invalid "随便写写" (no parse) ---');
await page.fill('input[name="startText"]', '随便写写');
await page.waitForTimeout(200);
state = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
}));
console.log('result:', state);

console.log('\n--- Test 6: picker button click triggers showPicker() ---');
const pickerResult = await page.evaluate(() => {
  // Click the button
  const btn = document.querySelector('button[aria-label="打开日期时间选择器"]');
  if (!btn) return { error: 'no button' };
  // Monkey-patch showPicker to detect call without actually opening
  const picker = document.querySelector('input[name="startAt"]');
  if (!picker) return { error: 'no hidden picker' };
  let called = false;
  picker.showPicker = function () { called = true; };
  btn.click();
  return { called, btnClicked: true };
});
console.log('picker click:', pickerResult);

console.log('\n--- Test 7: simulated picker change ---');
await page.evaluate(() => {
  const picker = document.querySelector('input[name="startAt"]');
  // Set value and fire change
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(picker, '2026-07-01T09:30');
  picker.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
state = await page.evaluate(() => ({
  startText: document.querySelector('input[name="startText"]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
console.log('result:', state);

// Screenshot for visual verification
await page.fill('input[name="startText"]', '');
await page.fill('input[name="startText"]', '明天下午3点');
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/opencode/local-merged-input.png', fullPage: false });
console.log('\nscreenshot: /tmp/opencode/local-merged-input.png');

await browser.close();
console.log('\nDONE');