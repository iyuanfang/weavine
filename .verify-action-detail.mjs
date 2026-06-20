import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';

const URL = 'http://localhost:3100';
const TEST_EMAIL = 'pesome@gmail.com';
const TEST_PASSWORD = '12345678';
const TEST_TITLE_PREFIX = '__verify_action_detail__';

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;
const createdIds = [];

function check(name, ok, extra) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`);
}

async function waitForDbState(fetcher, predicate, timeoutMs = 8000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    latest = await fetcher();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return latest;
}

async function cleanup(ownerId) {
  await prisma.interaction.deleteMany({ where: { ownerId, summary: { startsWith: TEST_TITLE_PREFIX } } });
  await prisma.action.deleteMany({ where: { ownerId, title: { startsWith: TEST_TITLE_PREFIX } } });
}

const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL }, select: { id: true } });
if (!user) throw new Error(`Missing test user: ${TEST_EMAIL}`);
await cleanup(user.id);

const contact = await prisma.contact.findFirst({ where: { ownerId: user.id }, select: { id: true } });
if (!contact) throw new Error(`Missing contact for test user: ${TEST_EMAIL}`);

const browser = await chromium.launch({ executablePath: '/home/yf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
  await page.goto(`${URL}/login`);
  await page.locator('input[name="email"]').fill(TEST_EMAIL);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/today/);

  const actionWithContact = await prisma.action.create({
    data: {
      ownerId: user.id,
      title: `${TEST_TITLE_PREFIX} with contact`,
      description: '原始描述',
      status: 'open',
      priority: 1,
      category: '合作',
      dueAt: new Date(Date.now() + 60 * 60 * 1000),
      contactId: contact.id,
    },
  });
  createdIds.push(actionWithContact.id);

  await page.goto(`${URL}/actions/${actionWithContact.id}`);
  await page.waitForLoadState('networkidle');

  check('no "✓ 完成" transition button', await page.locator('button:has-text("✓ 完成")').count() === 0);
  check('single "标记完成" button exists', await page.locator('button:has-text("标记完成")').count() === 1);
  check('header 编辑 link exists', await page.locator(`a[href="/actions/${actionWithContact.id}/edit"]`).count() === 1);
  check('no "安排时间"', await page.locator('a:has-text("安排时间")').count() === 0);
  check('has "安排日程"', await page.locator('a:has-text("安排日程")').count() === 1);

  await page.locator(`a[href="/actions/${actionWithContact.id}/edit"]`).click();
  await page.waitForURL(`**/actions/${actionWithContact.id}/edit`);
  check('edit page loaded', page.url().endsWith(`/actions/${actionWithContact.id}/edit`), `url=${page.url()}`);
  check('edit page title shown', (await page.locator('h1').first().textContent())?.includes('编辑：') ?? false);
  check('title pre-filled', (await page.locator('input[name="title"]').inputValue()) === actionWithContact.title);

  await page.locator('input[name="title"]').fill(`${TEST_TITLE_PREFIX} edited title`);
  await page.locator('textarea[name="description"]').fill('编辑后的描述');
  await page.locator('button:has-text("保存")').click();
  await page.waitForURL(`**/actions/${actionWithContact.id}`);
  const edited = await prisma.action.findUnique({ where: { id: actionWithContact.id } });
  check('save redirects to detail', page.url().endsWith(`/actions/${actionWithContact.id}`), `url=${page.url()}`);
  check('edit saved title', edited?.title === `${TEST_TITLE_PREFIX} edited title`, `title=${edited?.title}`);
  check('edit saved description', edited?.description === '编辑后的描述', `desc=${edited?.description}`);

  const resultWithContact = `${TEST_TITLE_PREFIX} completion with contact`;
  await page.locator('button:has-text("标记完成")').click();
  await page.locator('textarea[name="result"]').fill(resultWithContact);
  await page.locator('button:has-text("完成并记录")').click();
  await page.waitForURL(`**/actions/${actionWithContact.id}`);
  const completedWithContact = await waitForDbState(
    () => prisma.action.findUnique({ where: { id: actionWithContact.id } }),
    (row) => row?.status === 'done' && row.description?.includes(resultWithContact),
  );
  const interaction = await waitForDbState(
    () => prisma.interaction.findFirst({ where: { ownerId: user.id, contactId: contact.id, summary: resultWithContact, channel: '结果' } }),
    Boolean,
  );
  check('after done: no "标记完成"', await page.locator('button:has-text("标记完成")').count() === 0);
  check('with contact: status done', completedWithContact?.status === 'done');
  check('with contact: result appended to description', completedWithContact?.description?.includes(resultWithContact) ?? false);
  check('with contact: interaction created', Boolean(interaction));

  const actionNoContact = await prisma.action.create({
    data: {
      ownerId: user.id,
      title: `${TEST_TITLE_PREFIX} no contact`,
      description: null,
      status: 'open',
      priority: 0,
    },
  });
  createdIds.push(actionNoContact.id);

  const resultNoContact = `${TEST_TITLE_PREFIX} completion no contact`;
  await page.goto(`${URL}/actions/${actionNoContact.id}`);
  await page.locator('button:has-text("标记完成")').click();
  await page.locator('textarea[name="result"]').fill(resultNoContact);
  await page.locator('button:has-text("完成并记录")').click();
  await page.waitForURL(`**/actions/${actionNoContact.id}`);
  const completedNoContact = await waitForDbState(
    () => prisma.action.findUnique({ where: { id: actionNoContact.id } }),
    (row) => row?.status === 'done' && row.description?.includes(resultNoContact),
  );
  const noContactInteraction = await prisma.interaction.findFirst({ where: { ownerId: user.id, summary: resultNoContact } });
  check('no contact: status done', completedNoContact?.status === 'done');
  check('no contact: result appended to description', completedNoContact?.description?.includes(resultNoContact) ?? false);
  check('no contact: no interaction created', !noContactInteraction);

  await page.screenshot({ path: '/tmp/opencode/action-detail-v2.png', fullPage: true });
} finally {
  await browser.close();
  await cleanup(user.id);
  await prisma.$disconnect();
}

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
