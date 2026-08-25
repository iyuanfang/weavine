import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

// First, register a fresh user via the API and capture tokens
const regResp = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    email: 'visual-debug4@local',
    password: 'TestPass123!',
    display_name: 'Debug3',
    device: {
      install_id: '00000000-0000-0000-0000-0000000f01644',
      app_version: '1.0.0',
      os: 'test',
      platform: 'web',
      name: 'test-device-1787619516'
    }
  })
});
const sess = await regResp.json();
console.log('user_id:', sess.user_id);

// Create a couple of notes
for (const [title, body] of [['测试笔记 1', '# Hi\n\n第一条测试'], ['测试笔记 2', '## 二号\n\n* foo\n* bar']]) {
  const r = await fetch('http://localhost:3000/api/notes', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'Authorization': `Bearer ${sess.access_token}`},
    body: JSON.stringify({title, body})
  });
  console.log(`created note "${title}":`, r.status, (await r.json()).id);
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript((s) => {
  localStorage.setItem('weavine.access_token', s.access_token);
  localStorage.setItem('weavine.refresh_token', s.refresh_token);
  localStorage.setItem('weavine.user_id', s.user_id);
}, sess);

const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('response', async (resp) => {
  if (resp.url().includes('/api/notes') && !resp.url().includes('backlinks')) {
    console.log(`[notes resp] ${resp.request().method()} ${resp.status()} ${resp.url().slice(-50)}`);
    if (resp.status() === 200) {
      const body = await resp.text();
      console.log(`  body[:300]: ${body.slice(0, 300)}`);
    }
  }
});

await page.goto('http://127.0.0.1:5181/notes', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const html = await page.locator('.page').innerHTML().catch(() => '(no .page)');
console.log('\n[.page html[:2500]]');
console.log(html.slice(0, 2500));

await browser.close();
