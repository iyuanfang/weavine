import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({
  executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`${URL}/login`, { waitUntil: 'domcontentloaded' });
if (page.url().includes('/login')) {
  await page.fill('input[name="email"]', 'pesome@gmail.com');
  await page.fill('input[name="password"]', '12345678');
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
}

await page.goto(`${URL}/actions/new`, { waitUntil: 'networkidle' });
await page.waitForSelector('input[type="datetime-local"][name="dueAt"]', { state: 'attached' });
await page.waitForSelector('input[type="text"][placeholder*="明天下午"]');

const dateTextInput = page.locator('input[type="text"][placeholder*="明天下午"]');
await dateTextInput.fill('后天上午10点');
await page.waitForFunction(() => document.querySelector('input[type="datetime-local"][name="dueAt"]')?.value !== '');
await dateTextInput.fill('');
await page.waitForFunction(() => document.querySelector('input[type="datetime-local"][name="dueAt"]')?.value === '');

const before = await page.evaluate(() => {
  const visible = document.querySelector('input[type="text"][placeholder*="明天下午"]');
  const hidden = document.querySelector('input[type="datetime-local"][name="dueAt"]');
  return { visible: visible?.value ?? null, hidden: hidden?.value ?? null };
});
check('initial visible date text is empty', before.visible === '', JSON.stringify(before));
check('initial hidden dueAt is empty', before.hidden === '', JSON.stringify(before));

const selected = '2026-06-21T14:30';
const after = await page.evaluate((selectedValue) => {
  const visible = document.querySelector('input[type="text"][placeholder*="明天下午"]');
  const hidden = document.querySelector('input[type="datetime-local"][name="dueAt"]');
  if (!hidden) throw new Error('hidden dueAt input not found');
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error('HTMLInputElement value setter not found');
  valueSetter.call(hidden, selectedValue);
  hidden.dispatchEvent(new Event('input', { bubbles: true }));
  hidden.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ visible: visible?.value ?? null, hidden: hidden.value });
    }, 100);
  });
}, selected);

check('hidden dueAt accepts picker-selected value', after.hidden === selected, JSON.stringify(after));
check('visible date text updates after picker selection', after.visible === '2026-06-21 14:30', JSON.stringify(after));

await page.screenshot({ path: '/tmp/opencode/dti-picker-selection.png', fullPage: true });
await browser.close();
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
