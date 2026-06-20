import { chromium } from 'playwright';

const URL = 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
function check(name, ok, extra) {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`[${tag}] ${name}${extra ? ` — ${extra}` : ''}`);
}

// 1. Sign up new test user
const email = `datalist-${Date.now()}@test.local`;
await page.goto(`${URL}/sign-up`);
await page.locator('input[name="email"]').fill(email);
await page.locator('input[name="password"]').fill('test1234');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
check('signup', !page.url().includes('/sign-up'), `url=${page.url()}`);

// 2. /events/new — type datalist
await page.goto(`${URL}/events/new`);
await page.waitForSelector('input[name="type"]', { timeout: 5000 });
const typeInput = page.locator('input[name="type"]');
const typeList = await typeInput.getAttribute('list');
check('events/new: type input has list attr', !!typeList);
const datalistId = typeList;
const opts = await page.locator(`datalist[id="${datalistId}"] option`).allTextContents();
check('events/new: datalist has 7 options', opts.length === 7, `count=${opts.length}, values=${JSON.stringify(opts)}`);
check('events/new: default value = meeting', (await typeInput.inputValue()) === 'meeting', `value=${await typeInput.inputValue()}`);

// Free-text type
await typeInput.fill('公司年会');
check('events/new: free-text type accepted', (await typeInput.inputValue()) === '公司年会');

// Choose built-in
await typeInput.fill('birthday');
check('events/new: built-in type accepted', (await typeInput.inputValue()) === 'birthday');

// 3. /actions/new — category datalist
await page.goto(`${URL}/actions/new`);
await page.waitForSelector('input[name="category"]', { timeout: 5000 });
const catInput = page.locator('input[name="category"]');
const catList = await catInput.getAttribute('list');
check('actions/new: category input has list attr', !!catList);
const catOpts = await page.locator(`datalist[id="${catList}"] option`).allTextContents();
check('actions/new: datalist has 7 options', catOpts.length === 7, `values=${JSON.stringify(catOpts)}`);

await catInput.fill('投资');
check('actions/new: free-text category accepted', (await catInput.inputValue()) === '投资');

// 4. Event detail page localization — pick an existing event id
await page.goto(`${URL}/today`);
const eventLink = page.locator('a[href^="/events/"]').first();
const hasEvent = await eventLink.count() > 0;
if (hasEvent) {
  await eventLink.click();
  await page.waitForLoadState('networkidle');
  const bodyText = await page.locator('body').innerText();
  // Raw english enum should NOT appear (unless it's "custom")
  const hasRawEnglish = /\b(meeting|birthday|anniversary|reminder)\b/.test(bodyText);
  check('event detail: localized (no raw English)', !hasRawEnglish, `body sample: ${bodyText.slice(0, 150)}`);
}

await page.screenshot({ path: '/tmp/opencode/datalist-final.png', fullPage: true });

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);