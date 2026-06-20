import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}

// Login
await page.goto('http://localhost:3100/login', { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', 'pesome@gmail.com');
await page.fill('input[name="password"]', '12345678');
await Promise.all([
  page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 10000 }),
  page.click('button[type="submit"]'),
]);
console.log('logged in\n');

// ========== Event Form ==========
console.log('=== /events/new (DateTimeInput for start + end) ===');
await page.goto('http://localhost:3100/events/new', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="startAt"]');

// Count visible text inputs and pickers in the time field
const evLayout = await page.evaluate(() => {
  const startVisible = document.querySelector('input[type="text"][required]');
  const startPicker = document.querySelector('input[type="datetime-local"][name="startAt"]');
  const endPicker = document.querySelector('input[type="datetime-local"][name="endAt"]');
  const startBtns = document.querySelectorAll('button[aria-label="打开日期时间选择器"]');
  return {
    hasStartVisible: !!startVisible,
    hasStartPicker: !!startPicker,
    hasEndPicker: !!endPicker,
    pickerBtnCount: startBtns.length,
    startStep: startPicker?.step,
    endStep: endPicker?.step,
    startName: startPicker?.name,
    endName: endPicker?.name,
  };
});
check('event: visible NL input exists', evLayout.hasStartVisible);
check('event: start picker name=startAt', evLayout.startName === 'startAt');
check('event: end picker name=endAt', evLayout.endName === 'endAt');
check('event: 2 calendar buttons (start+end)', evLayout.pickerBtnCount === 2);
check('event: start step=900', evLayout.startStep === '900');
check('event: end step=900', evLayout.endStep === '900');

// Initial empty
const evInit = await page.evaluate(() => ({
  startText: document.querySelector('input[type="text"][required]').value,
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
check('event: initial startAt empty', evInit.startAt === '');
check('event: initial endAt empty', evInit.endAt === '');

// Click start picker
const now = new Date();
const expMin = Math.floor(now.getMinutes() / 15) * 15;
await page.click('button[aria-label="打开日期时间选择器"]');
await page.waitForFunction(() => document.querySelector('input[name="startAt"]')?.value !== '');
const evPicked = await page.evaluate(() => ({
  startAt: document.querySelector('input[name="startAt"]').value,
  endAt: document.querySelector('input[name="endAt"]').value,
}));
const parsed = evPicked.startAt ? new Date(evPicked.startAt) : null;
check('event: picker click sets startAt', !!parsed);
if (parsed) {
  check(`event: hour matches current (${parsed.getHours()} vs ${now.getHours()})`, parsed.getHours() === now.getHours());
  check(`event: minute on 15-step (${parsed.getMinutes()} vs ${expMin})`, parsed.getMinutes() === expMin);
}
check('event: picker click auto-fills endAt (start+1h)', evPicked.endAt !== '' && new Date(evPicked.endAt).getTime() === new Date(evPicked.startAt).getTime() + 3600000);

// Type NL in start (use fill — one-shot value set, fast enough for React to commit fully)
await page.locator('input[type="text"][required]').first().fill('后天上午10点');
await page.waitForTimeout(300);
const evNL = await page.evaluate(() => ({
  startAt: document.querySelector('input[name="startAt"]').value,
}));
const nlDate = evNL.startAt ? new Date(evNL.startAt) : null;
check('event: NL "后天上午10点" parses', !!nlDate);
if (nlDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayAfter = new Date(today);
  dayAfter.setDate(dayAfter.getDate() + 2);
  check(`event: NL date is day-after-tomorrow (${nlDate.toLocaleDateString('zh-CN')})`,
    nlDate.getFullYear() === dayAfter.getFullYear() &&
    nlDate.getMonth() === dayAfter.getMonth() &&
    nlDate.getDate() === dayAfter.getDate());
  check(`event: NL hour=10`, nlDate.getHours() === 10);
}

await page.screenshot({ path: '/tmp/opencode/dti-event-form.png', fullPage: true });

// ========== Interaction Form (contact page) ==========
console.log('\n=== /contacts/[id] (interaction log) ===');
await page.goto('http://localhost:3100/contacts', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('a[href^="/contacts/"]');
const allContactHrefs = await page.locator('a[href^="/contacts/"]').evaluateAll((els) =>
  els.map((el) => el.getAttribute('href')).filter((h) => h && !h.endsWith('/new') && h.split('/').length === 3),
);
console.log('  contact hrefs (excluding /new):', allContactHrefs.slice(0, 3));
const firstContactHref = allContactHrefs[0];
if (!firstContactHref) {
  console.log('  no existing contact found — creating one');
  await page.goto('http://localhost:3100/contacts/new', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="nickname"]', '测试');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: 10000 });
}
const contactUrl = firstContactHref || page.url();
console.log('  navigating to contact:', contactUrl);
await page.goto(`http://localhost:3100${contactUrl}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.waitForSelector('input[name="occurredAt"]');
const ifLayout = await page.evaluate(() => {
  const allOcc = Array.from(document.querySelectorAll('input[name="occurredAt"]'));
  return {
    picker: document.querySelector('input[type="datetime-local"][name="occurredAt"]'),
    allOccTypes: allOcc.map((el) => el.type),
    btns: document.querySelectorAll('button[aria-label="打开日期时间选择器"]').length,
    initialValue: document.querySelector('input[type="datetime-local"][name="occurredAt"]')?.value,
  };
});
check('interaction: occurredAt picker exists', !!ifLayout.picker);
check('interaction: only datetime-local has name=occurredAt (NL input has no name)',
  ifLayout.allOccTypes.length === 1 && ifLayout.allOccTypes[0] === 'datetime-local');
check('interaction: picker pre-filled with current time', ifLayout.initialValue !== '');
check('interaction: at least 1 picker button', ifLayout.btns >= 1);

await page.screenshot({ path: '/tmp/opencode/dti-interaction-form.png', fullPage: true });

// ========== Quick Log ==========
// SKIPPED: QuickLog component is defined but not wired into any layout (no import in src/app/).
// Build verification + manual code review covers this case. See git log: 085c9ec, 41b7ee2.

// ========== Quick Add Action ==========
console.log('\n=== Quick Add Action (+ 添加 button) ===');
await page.goto('http://localhost:3100/actions', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('button:has-text("+ 添加")');
await page.click('button:has-text("+ 添加")');
await page.waitForTimeout(300);
const qaLayout = await page.evaluate(() => ({
  textInputs: Array.from(document.querySelectorAll('input[type="text"]')).map((el) => el.placeholder),
  hiddenPickers: Array.from(document.querySelectorAll('input[type="datetime-local"]')).map((el) => el.name),
  buttons: document.querySelectorAll('button[aria-label="打开日期时间选择器"]').length,
}));
check('quick-add: text input for dueAt (placeholder=截止)', qaLayout.textInputs.some((p) => p?.includes('截止')));
check('quick-add: hidden picker for dueAt', qaLayout.hiddenPickers.includes('__unused_due'));
check('quick-add: 1 picker button', qaLayout.buttons === 1);

await page.screenshot({ path: '/tmp/opencode/dti-quick-add.png', fullPage: true });

// ========== New Action Form ==========
console.log('\n=== /actions/new (full page form) ===');
await page.goto('http://localhost:3100/actions/new', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[name="dueAt"]');
await page.waitForTimeout(500); // allow React hydration after client-side nav
const nafLayout = await page.evaluate(() => {
  const visible = Array.from(document.querySelectorAll('input[type="text"]')).find((el) =>
    el.placeholder?.includes('明天下午') || el.placeholder?.includes('2026'),
  );
  const hidden = document.querySelector('input[type="datetime-local"][name="dueAt"]');
  return {
    hasVisible: !!visible,
    hasHidden: !!hidden,
    visibleRequired: visible?.required,
    helperText: document.body.textContent.includes('支持自然语言'),
  };
});
check('new-action: visible NL input exists', nafLayout.hasVisible);
check('new-action: hidden picker exists', nafLayout.hasHidden);
check('new-action: helper text shows', nafLayout.helperText);

// Type NL (use fill — single event, React commits final parse cleanly)
await page.locator('input[type="text"][placeholder*="明天下午"]').fill('下周一上午9点');
await page.waitForTimeout(300);
const nafNL = await page.evaluate(() => document.querySelector('input[name="dueAt"]').value);
const nafDate = nafNL ? new Date(nafNL) : null;
check('new-action: NL "下周一上午9点" parses', !!nafDate);
if (nafDate) {
  check(`new-action: NL hour=9 (got ${nafDate.getHours()})`, nafDate.getHours() === 9);
}

await page.screenshot({ path: '/tmp/opencode/dti-new-action.png', fullPage: true });

await browser.close();

console.log('\n========== SUMMARY ==========');
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILED:');
  results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name} ${r.detail}`));
  process.exit(1);
}
console.log('ALL PASS');