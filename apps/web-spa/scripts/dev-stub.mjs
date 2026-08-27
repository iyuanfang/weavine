// Stateful local stub backend for web-spa dev when the prod weavine-server
// is unreachable. Keeps notes/contacts/etc. in memory and responds to the
// few endpoints the UI exercises. NOT a real backend — no auth, no
// persistence, no transaction guarantees.

import { createServer } from 'node:http';

const PORT = 3000;
const USER_ID = 'dev-stub';

const sendJson = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = '';
    req.on('data', (chunk) => (buf += chunk));
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : null);
      } catch {
        resolve(null);
      }
    });
  });

const now = () => new Date().toISOString();
let nextId = 1;
const id = (prefix) => `${prefix}-${nextId++}-${Date.now().toString(36)}`;

// In-memory stores
const notes = new Map();
const contacts = new Map();
const tags = new Map();
const events = new Map();
const actions = new Map();
const interactions = new Map();
const projects = new Map();
const reminders = new Map();

// Seed one demo note + tag so the UI shows something on first visit.
function seed() {
  const tagId = id('tag');
  tags.set(tagId, {
    id: tagId,
    name: '示例',
    color: '#10b981',
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  });
  const noteId = id('note');
  notes.set(noteId, {
    id: noteId,
    title: '欢迎使用 Weavine',
    body: '# 欢迎\n\n这是 stub backend 注入的示例笔记。\n\n点 + 新建笔记创建你自己的。\n\n## 提示\n- 数据存在内存里，**重启 stub 会清空**\n- 刷新页面数据还在（stub 进程内）\n- 真实后端在 prod 47.79.43.80:3000',
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
    tag_ids: [tagId],
  });
}
seed();

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    res.end();
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const qs = url.searchParams;
  console.log(req.method, path);

  if (path === '/health') return sendJson(res, 200, { ok: true });

  // ── Auth ───────────────────────────────────────────────
  if (path === '/api/auth/me') {
    return sendJson(res, 200, {
      user_id: USER_ID,
      email: 'dev@local.test',
      name: 'Dev Stub',
    });
  }
  if (path === '/api/auth/login') {
    return sendJson(res, 200, { token: 'stub-jwt', user_id: USER_ID });
  }
  if (path === '/api/auth/logout') return sendJson(res, 200, {});

  // ── Notes ──────────────────────────────────────────────
  if (path === '/api/notes' && req.method === 'GET') {
    const all = Array.from(notes.values())
      .filter((n) => !n.deleted_at)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return sendJson(res, 200, { items: all, cursor: null, has_more: false });
  }
  if (path === '/api/notes' && req.method === 'POST') {
    const body = await readBody(req);
    const noteId = id('note');
    const note = {
      id: noteId,
      title: body?.title ?? '（无标题）',
      body: body?.body ?? '',
      tag_ids: body?.tag_ids ?? [],
      entity_links: body?.entity_links ?? [],
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    };
    notes.set(noteId, note);
    return sendJson(res, 200, note);
  }
  const noteGetMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (noteGetMatch && req.method === 'GET') {
    const n = notes.get(noteGetMatch[1]);
    if (!n) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, n);
  }
  const notePutMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (notePutMatch && req.method === 'PUT') {
    const body = await readBody(req);
    const existing = notes.get(notePutMatch[1]);
    if (!existing) return sendJson(res, 404, { error: 'not found' });
    const updated = {
      ...existing,
      title: body?.title ?? existing.title,
      body: body?.body ?? existing.body,
      tag_ids: body?.tag_ids ?? existing.tag_ids,
      entity_links: body?.entity_links ?? existing.entity_links,
      updated_at: now(),
    };
    notes.set(updated.id, updated);
    return sendJson(res, 200, updated);
  }
  const noteDelMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (noteDelMatch && req.method === 'DELETE') {
    const existing = notes.get(noteDelMatch[1]);
    if (existing) {
      existing.deleted_at = now();
      notes.set(existing.id, existing);
    }
    return sendJson(res, 200, {});
  }
  if (path === '/api/notes/backlinks' && req.method === 'GET') {
    return sendJson(res, 200, []);
  }
  const noteEntitiesMatch = /^\/api\/notes\/([^/]+)\/entities$/.exec(path);
  if (noteEntitiesMatch && req.method === 'GET') {
    const n = notes.get(noteEntitiesMatch[1]);
    return sendJson(res, 200, n?.entity_links ?? []);
  }

  // ── Generic collection lists (return empty) ────────────
  const listPaths = [
    '/api/contacts',
    '/api/tags',
    '/api/events',
    '/api/actions',
    '/api/interactions',
    '/api/projects',
    '/api/reminders',
  ];
  if (listPaths.includes(path) && req.method === 'GET') {
    return sendJson(res, 200, { items: [], cursor: null, has_more: false });
  }

  // ── upcoming events shortcut ──────────────────────────
  if (path === '/api/events/upcoming' && req.method === 'GET') {
    return sendJson(res, 200, []);
  }

  // ── settings ──────────────────────────────────────────
  if (path === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, {
      timezone: 'Asia/Shanghai',
      week_start: 1,
      theme: 'system',
    });
  }

  // ── activation ping (no-op for stub) ─────────────────
  if (path === '/api/activation/ping' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true });
  }

  // Default: empty
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub on :${PORT} (stateful, seeded 1 note + 1 tag)`);
});
