import { chromium } from 'playwright';
const URL = 'https://ai.financialagent.cc';
const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

let pass = 0, fail = 0;
const check = (n, ok, x) => { (ok?pass++:fail++); console.log(`[${ok?'PASS':'FAIL'}] ${n}${x?` — ${x}`:''}`); };

await page.goto(`${URL}/sign-up`);
const email = `prod-${Date.now()}@test.local`;
await page.locator('input[name="email"]').fill(email);
await page.locator('input[name="password"]').fill('test1234');
await page.locator('button[type="submit"]').click();
await page.waitForLoadState('networkidle');
check('signup', !page.url().includes('/sign-up'), `url=${page.url()}`);

await page.goto(`${URL}/events/new`);
await page.waitForSelector('input[name="type"]', { timeout: 8000 });
const typeInput = page.locator('input[name="type"]');
const typeList = await typeInput.getAttribute('list');
check('prod events/new: type has list', !!typeList);
const opts = await page.locator(`datalist[id="${typeList}"] option`).allTextContents();
check('prod events/new: 7 datalist opts', opts.length === 7, `vals=${JSON.stringify(opts)}`);
check('prod events/new: default = meeting', (await typeInput.inputValue()) === 'meeting');
await typeInput.fill('公司年会');
check('prod events/new: free-text', (await typeInput.inputValue()) === '公司年会');

await page.goto(`${URL}/actions/new`);
await page.waitForSelector('input[name="category"]', { timeout: 8000 });
const catInput = page.locator('input[name="category"]');
const catList = await catInput.getAttribute('list');
check('prod actions/new: category has list', !!catList);
const cOpts = await page.locator(`datalist[id="${catList}"] option`).allTextContents();
check('prod actions/new: 7 datalist opts', cOpts.length === 7, `vals=${JSON.stringify(cOpts)}`);
await catInput.fill('投资');
check('prod actions/new: free-text', (await catInput.inputValue()) === '投资');

await page.screenshot({ path: '/tmp/opencode/prod-datalist.png', fullPage: true });
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
