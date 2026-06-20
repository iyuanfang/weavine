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

const info = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="打开日期时间选择器"]');
  const rect = btn.getBoundingClientRect();
  const cs = getComputedStyle(btn);
  const textRect = document.querySelector('input[name="startText"]').getBoundingClientRect();
  return {
    btn: {
      visible: rect.width > 0 && rect.height > 0,
      x: rect.x, y: rect.y, w: rect.width, h: rect.height,
      position: cs.position,
      right: cs.right, top: cs.top,
      fontFamily: cs.fontFamily,
      text: btn.textContent,
    },
    textInput: { x: textRect.x, y: textRect.y, w: textRect.width, h: textRect.height },
  };
});
console.log(JSON.stringify(info, null, 2));

// Crop screenshot of just the input area
await page.screenshot({ path: '/tmp/opencode/local-input-zoom.png', clip: { x: info.textInput.x - 10, y: info.textInput.y - 30, width: info.textInput.w + 30, height: info.textInput.h + 30 } });
console.log('zoom: /tmp/opencode/local-input-zoom.png');

await browser.close();
