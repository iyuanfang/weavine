# PRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Personal Relationship Manager (PRM) web app exactly as specified in `docs/superpowers/specs/2026-06-14-prm-design.md`: contacts + tags + events + interactions + needs + NL search + reminders + push + dashboard, all single-user local-first on Next.js 14 + Prisma + SQLite.

**Architecture:** Next.js 14 App Router monolith. Server Actions for mutations, route handlers for search/push. Domain services in `src/server/services/*` are pure-ish (no HTTP), tested in isolation with Vitest. TanStack Query for client reads/mutations where optimistic UI matters. SQLite FTS5 virtual table mirrored from `Contact` via triggers. Cron `* * * * *` in-process via `node-cron` for reminders.

**Tech Stack:** Next.js 14.2.5 · TypeScript 5.5 · Prisma 5.18 · SQLite (better-sqlite3 11) · Tailwind 3.4 · TanStack Query 5 · FullCalendar (daygrid/timegrid/list/interaction) · node-cron 3 · web-push 3.6 · zod 3.23 · Vitest 2 · Playwright 1.46. pnpm 9. zh-CN UI strings only.

**Conventions:**
- All paths in tasks are relative to repo root `/home/yf/workspace/opencode/prm`.
- `src/lib/prisma.ts` is the singleton client. Import it as `import { prisma } from '@/lib/prisma'`.
- `src/lib/errors.ts` defines `NotFoundError`, `ValidationError`. Services throw these; route handlers/action wrapper map to HTTP/UI.
- Tests live next to source as `*.test.ts` (Vitest, in-source) for unit/service; `e2e/*.spec.ts` for Playwright.
- Commit after every task. Conventional Commits: `feat:`, `test:`, `chore:`, `fix:`, `docs:`.
- `pnpm test` must pass at end of every phase.

---

## Phase 0 — Bootstrap

### Task 0.1: Init pnpm + Next.js skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `.env.example`, `.gitignore`, `README.md`, `vitest.config.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `src/__tests__/smoke.test.ts`, `e2e/smoke.spec.ts`
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css` (Tailwind directives)

- [ ] **Step 1: Write package.json** — see code block.

```json
{
  "name": "prm",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:push": "prisma db push",
    "db:seed": "tsx prisma/seed.ts",
    "db:reset": "prisma db push --force-reset"
  },
  "dependencies": {
    "@prisma/client": "5.18.0",
    "@tanstack/react-query": "5.51.0",
    "bcryptjs": "2.4.3",
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "web-push": "3.6.7",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "1.46.0",
    "@types/bcryptjs": "2.4.6",
    "@types/node": "20.14.10",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@types/web-push": "3.6.3",
    "autoprefixer": "10.4.19",
    "postcss": "8.4.40",
    "prisma": "5.18.0",
    "tailwindcss": "3.4.7",
    "tsx": "4.16.2",
    "typescript": "5.5.3",
    "vitest": "2.0.5"
  },
  "packageManager": "pnpm@9.6.0"
}
```

- [ ] **Step 2: Write tsconfig.json** — strict, `@/*` -> `src/*`.

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false, "skipLibCheck": true, "strict": true, "noEmit": true,
    "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve",
    "incremental": true, "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write next.config.mjs**

```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, experimental: { serverActions: { allowedOrigins: ['localhost:3000'] } } };
export default nextConfig;
```

- [ ] **Step 4: Write .env.example, .gitignore, README.md**

```
DATABASE_URL="file:./prisma/dev.db"
NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:you@example.com"
```

```
node_modules, .next, .env, .env.local, prisma/dev.db*, coverage, test-results, playwright-report, *.log
```

```
# PRM
Personal Relationship Manager. See docs/superpowers/specs/2026-06-14-prm-design.md.
pnpm install && pnpm db:push && pnpm dev
```

- [ ] **Step 5: Tailwind + PostCSS + globals.css**

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';
export default { content: ['./src/**/*.{ts,tsx}'], theme: { extend: { colors: { accent: { DEFAULT: '#2563eb' } } } }, plugins: [] } satisfies Config;
```

```js
// postcss.config.mjs
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

```css
/* src/app/globals.css */
@tailwind base; @tailwind components; @tailwind utilities;
:root { color-scheme: light; }
body { font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
```

- [ ] **Step 6: Root layout + home page + /api/health**

```tsx
// src/app/layout.tsx
import './globals.css';
import { Providers } from './providers';
export const metadata = { title: 'PRM', description: '人脉管理' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="zh-CN"><body><Providers>{children}</Providers></body></html>);
}
```

```tsx
// src/app/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

```tsx
// src/app/page.tsx
import Link from 'next/link';
export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold">PRM · 人脉管理</h1>
      <p className="mt-2 text-gray-600">记录联系人、见面、需求，保持关系网鲜活。</p>
      <nav className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <Link className="rounded border p-3 hover:bg-gray-50" href="/contacts">联系人</Link>
        <Link className="rounded border p-3 hover:bg-gray-50" href="/calendar">日程</Link>
        <Link className="rounded border p-3 hover:bg-gray-50" href="/needs">需求</Link>
        <Link className="rounded border p-3 hover:bg-gray-50" href="/search">搜索</Link>
      </nav>
    </main>
  );
}
```

```ts
// src/app/api/health/route.ts
export const dynamic = 'force-dynamic';
export async function GET() { return Response.json({ ok: true, ts: Date.now() }); }
```

- [ ] **Step 7: Vitest + Playwright config + smoke tests**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] }, resolve: { alias: { '@': path.resolve(__dirname, './src') } } });
```

```ts
// src/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('smoke', () => { it('arithmetic', () => { expect(1+1).toBe(2); }); });
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e', fullyParallel: true, use: { baseURL: 'http://localhost:3000' }, webServer: { command: 'pnpm dev', port: 3000, reuseExistingServer: !process.env.CI }, projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }] });
```

```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';
test('home page loads', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: 'PRM' })).toBeVisible(); });
test('health endpoint', async ({ request }) => { const r = await request.get('/api/health'); expect(r.ok()).toBeTruthy(); });
```

- [ ] **Step 8: Install + verify**

```bash
pnpm install
pnpm test
pnpm exec playwright install --with-deps chromium
pnpm build
```

Expected: build succeeds, vitest passes, playwright installs. `pnpm dev` then `curl localhost:3000/api/health` returns `{"ok":true,...}`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore(bootstrap): Next.js 14 + Prisma + Tailwind + Vitest + Playwright skeleton"
```

---

## Phase 1 — Contacts + Tags

### Task 1.1: Prisma schema for Contact/Tag/ContactTag

**Files:** Create `prisma/schema.prisma`.

- [ ] **Step 1: Write schema**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite"; url = env("DATABASE_URL") }

model Contact {
  id              String   @id @default(cuid())
  name            String
  company         String?
  title           String?
  city            String?
  email           String?
  phone           String?
  wechat          String?
  birthdayMonth   Int?
  birthdayDay     Int?
  notes           String?
  lastContactedAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  tags            ContactTag[]
  events          EventAttendee[]
  interactions    Interaction[]
  needs           Need[]
  reminders       Reminder[] @relation("ContactReminders")
  @@index([name])
  @@index([company])
  @@index([city])
}

model Tag {
  id        String   @id @default(cuid())
  name      String   @unique
  color     String?
  contacts  ContactTag[]
  createdAt DateTime @default(now())
}

model ContactTag {
  contactId String
  tagId     String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([contactId, tagId])
  @@index([tagId])
}
```

- [ ] **Step 2: Push + generate**

```bash
pnpm db:push && pnpm exec prisma generate
```

- [ ] **Step 3: Commit**

```bash
git add prisma/ && git commit -m "feat(db): Contact, Tag, ContactTag models"
```

### Task 1.2: Prisma singleton + error types + zod

**Files:** `src/lib/prisma.ts`, `src/lib/errors.ts`, `src/lib/validation/contact.ts`, `src/lib/action.ts`.

- [ ] **Step 1: prisma singleton**

```ts
import { PrismaClient } from '@prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: ['error', 'warn'] });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
```

- [ ] **Step 2: errors**

```ts
export class NotFoundError extends Error { constructor(m: string) { super(m); this.name = 'NotFoundError'; } }
export class ValidationError extends Error { issues: unknown; constructor(m: string, issues?: unknown) { super(m); this.name = 'ValidationError'; this.issues = issues; } }
```

- [ ] **Step 3: action wrapper** (zod-parse FormData -> call -> map errors to UI)

```ts
'use server';
import { z } from 'zod';
import { ValidationError } from './errors';
export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
export async function runAction<T>(schema: z.ZodType<T>, formData: FormData, fn: (input: T) => Promise<T>): Promise<ActionResult<T>> {
  const obj = Object.fromEntries(formData.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) return { ok: false, error: '校验失败', fieldErrors: parsed.error.flatten().fieldErrors as any };
  try { return { ok: true, data: await fn(parsed.data) }; }
  catch (e: any) { if (e instanceof ValidationError) return { ok: false, error: e.message, fieldErrors: e.issues as any }; return { ok: false, error: e?.message ?? '未知错误' }; }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ && git commit -m "feat(lib): prisma singleton, errors, action wrapper"
```

### Task 1.3: ContactService — TDD

**Files:** `src/server/services/contact.ts`, `src/server/services/contact.test.ts`, `src/server/services/_db.ts`.

- [ ] **Step 1: Test helper** — uses a temp SQLite file per test, runs `prisma db push` once per worker.

```ts
// src/server/services/_db.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let _db: PrismaClient | null = null; let _dir: string | null = null;
export function testDb() {
  if (_db) return _db;
  _dir = mkdtempSync(join(tmpdir(), 'prm-test-'));
  const url = `file:${join(_dir, 'test.db')}`;
  process.env.DATABASE_URL = url;
  execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  _db = new PrismaClient({ datasources: { db: { url } } });
  return _db;
}
export function closeTestDb() { _db?.$disconnect(); if (_dir) rmSync(_dir, { recursive: true, force: true }); _db = null; _dir = null; }
```

- [ ] **Step 2: Write failing tests** — covers create, list with tag filter, get by id (NotFoundError), update, soft delete (we hard-delete for v1), contact list ordering by `lastContactedAt desc, updatedAt desc`.

```ts
// src/server/services/contact.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { ContactService } from './contact';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('ContactService', () => {
  it('creates and lists contacts', async () => { const c = await ContactService.create({ name: '张三' }); expect(c.id).toBeTruthy(); const all = await ContactService.list({}); expect(all).toHaveLength(1); });
  it('filters by tag', async () => { const tag = await testDb().tag.create({ data: { name: '朋友' } }); const a = await ContactService.create({ name: 'A' }); const b = await ContactService.create({ name: 'B' }); await testDb().contactTag.create({ data: { contactId: a.id, tagId: tag.id } }); const r = await ContactService.list({ tagId: tag.id }); expect(r.map(c => c.name)).toEqual(['A']); });
  it('updates fields and updatedAt', async () => { const c = await ContactService.create({ name: 'A' }); const u = await ContactService.update(c.id, { company: 'X' }); expect(u.company).toBe('X'); });
  it('throws NotFoundError on missing', async () => { await expect(ContactService.get('nope')).rejects.toThrow(/不存在/); });
  it('enforces birthday month/day range', async () => { await expect(ContactService.create({ name: 'A', birthdayMonth: 13 })).rejects.toThrow(); await expect(ContactService.create({ name: 'A', birthdayDay: 0 })).rejects.toThrow(); });
});
```

- [ ] **Step 3: Run — expect fail** `pnpm test contact`

- [ ] **Step 4: Implement** (uses zod; zodBirthday check).

```ts
// src/server/services/contact.ts
import { z } from 'zod';
import { prisma as defaultPrisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { PrismaClient } from '@prisma/client';
const contactInput = z.object({
  name: z.string().min(1).max(80),
  company: z.string().max(120).nullish(),
  title: z.string().max(120).nullish(),
  city: z.string().max(60).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().max(40).nullish(),
  wechat: z.string().max(60).nullish(),
  birthdayMonth: z.number().int().min(1).max(12).nullish(),
  birthdayDay: z.number().int().min(1).max(31).nullish(),
  notes: z.string().max(8000).nullish(),
});
export type ContactInput = z.infer<typeof contactInput>;
export const ContactService = {
  async create(input: ContactInput, db: PrismaClient = defaultPrisma) {
    const p = contactInput.parse(input);
    return db.contact.create({ data: p });
  },
  async get(id: string, db: PrismaClient = defaultPrisma) {
    const c = await db.contact.findUnique({ where: { id }, include: { tags: { include: { tag: true } } } });
    if (!c) throw new NotFoundError('联系人不存在');
    return c;
  },
  async list(filter: { tagId?: string; q?: string }, db: PrismaClient = defaultPrisma) {
    return db.contact.findMany({
      where: {
        ...(filter.tagId ? { tags: { some: { tagId: filter.tagId } } } : {}),
        ...(filter.q ? { OR: [{ name: { contains: filter.q } }, { company: { contains: filter.q } }, { city: { contains: filter.q } }] } : {}),
      },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ lastContactedAt: 'desc' }, { updatedAt: 'desc' }],
    });
  },
  async update(id: string, input: Partial<ContactInput>, db: PrismaClient = defaultPrisma) {
    const p = contactInput.partial().parse(input);
    try { return await db.contact.update({ where: { id }, data: p }); }
    catch { throw new NotFoundError('联系人不存在'); }
  },
  async remove(id: string, db: PrismaClient = defaultPrisma) {
    try { await db.contact.delete({ where: { id } }); }
    catch { throw new NotFoundError('联系人不存在'); }
  },
};
```

- [ ] **Step 5: Run — pass** `pnpm test contact`

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(contacts): ContactService CRUD with tests"
```

### Task 1.4: TagService — TDD

**Files:** `src/server/services/tag.ts`, `src/server/services/tag.test.ts`.

- [ ] **Step 1: Tests** — create, unique-name conflict, list, attach/detach to contact.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { TagService } from './tag';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('TagService', () => {
  it('creates and lists tags', async () => { await TagService.create({ name: '同事', color: '#888' }); const t = await TagService.list(); expect(t).toHaveLength(1); });
  it('rejects duplicate name', async () => { await TagService.create({ name: '同事' }); await expect(TagService.create({ name: '同事' })).rejects.toThrow(); });
  it('attaches and detaches', async () => { const t = await TagService.create({ name: 'A' }); const c = await testDb().contact.create({ data: { name: 'X' } }); await TagService.attach(c.id, t.id); expect(await TagService.forContact(c.id)).toHaveLength(1); await TagService.detach(c.id, t.id); expect(await TagService.forContact(c.id)).toHaveLength(0); });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
const tagInput = z.object({ name: z.string().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish() });
export const TagService = {
  async create(input: z.infer<typeof tagInput>) { return prisma.tag.create({ data: tagInput.parse(input) }); },
  async list() { return prisma.tag.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { contacts: true } } } }); },
  async rename(id: string, name: string) { return prisma.tag.update({ where: { id }, data: { name } }); },
  async remove(id: string) { await prisma.tag.delete({ where: { id } }); },
  async attach(contactId: string, tagId: string) { await prisma.contactTag.upsert({ where: { contactId_tagId: { contactId, tagId } }, create: { contactId, tagId }, update: {} }); },
  async detach(contactId: string, tagId: string) { await prisma.contactTag.delete({ where: { contactId_tagId: { contactId, tagId } } }).catch(() => {}); },
  async forContact(contactId: string) { return prisma.contactTag.findMany({ where: { contactId }, include: { tag: true } }); },
};
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm test tag && git add -A && git commit -m "feat(tags): TagService with attach/detach"
```

### Task 1.5: Contact pages

**Files:** `src/app/contacts/page.tsx`, `src/app/contacts/new/page.tsx`, `src/app/contacts/[id]/page.tsx`, `src/app/contacts/[id]/edit/page.tsx`, `src/app/contacts/actions.ts`, `src/components/contact-form.tsx`, `src/components/tag-picker.tsx`, `src/components/contact-card.tsx`, `src/components/empty-state.tsx`.

- [ ] **Step 1: Server actions** in `actions.ts`

```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ContactService, type ContactInput } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
export async function createContactAction(_: unknown, fd: FormData) {
  const input = parseContact(fd);
  const c = await ContactService.create(input);
  const tags = fd.getAll('tagId').map(String).filter(Boolean);
  for (const t of tags) await TagService.attach(c.id, t);
  revalidatePath('/contacts'); redirect(`/contacts/${c.id}`);
}
export async function updateContactAction(id: string, _: unknown, fd: FormData) {
  const input = parseContact(fd);
  await ContactService.update(id, input);
  const tags = new Set(fd.getAll('tagId').map(String).filter(Boolean));
  const current = await TagService.forContact(id);
  for (const ct of current) if (!tags.has(ct.tagId)) await TagService.detach(id, ct.tagId);
  for (const t of tags) await TagService.attach(id, t);
  revalidatePath('/contacts'); revalidatePath(`/contacts/${id}`); redirect(`/contacts/${id}`);
}
export async function deleteContactAction(id: string) { await ContactService.remove(id); revalidatePath('/contacts'); redirect('/contacts'); }
function parseContact(fd: FormData): ContactInput {
  const num = (k: string) => { const v = fd.get(k); return v && String(v) !== '' ? Number(v) : null; };
  return {
    name: String(fd.get('name') ?? ''),
    company: (fd.get('company') as string) || null,
    title: (fd.get('title') as string) || null,
    city: (fd.get('city') as string) || null,
    email: (fd.get('email') as string) || null,
    phone: (fd.get('phone') as string) || null,
    wechat: (fd.get('wechat') as string) || null,
    birthdayMonth: num('birthdayMonth'), birthdayDay: num('birthdayDay'),
    notes: (fd.get('notes') as string) || null,
  } as ContactInput;
}
```

- [ ] **Step 2: List page** (server component fetches, search via `?q=&tag=`).

```tsx
// src/app/contacts/page.tsx
import Link from 'next/link';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { ContactCard } from '@/components/contact-card';
export default async function ContactsPage({ searchParams }: { searchParams: { q?: string; tag?: string } }) {
  const [list, tags] = await Promise.all([ContactService.list({ q: searchParams.q, tagId: searchParams.tag }), TagService.list()]);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">联系人</h1><Link href="/contacts/new" className="rounded bg-accent px-3 py-1.5 text-white">新建</Link></div>
      <form className="mt-4 flex gap-2" action="/contacts"><input name="q" defaultValue={searchParams.q ?? ''} placeholder="搜索 姓名/公司/城市" className="rounded border px-2 py-1 flex-1" /><select name="tag" defaultValue={searchParams.tag ?? ''} className="rounded border px-2 py-1"><option value="">全部标签</option>{tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="rounded border px-3">筛选</button></form>
      <ul className="mt-4 grid gap-2">{list.length === 0 ? <li className="text-gray-500">暂无联系人</li> : list.map(c => <ContactCard key={c.id} contact={c} />)}</ul>
    </main>
  );
}
```

```tsx
// src/components/contact-card.tsx
import Link from 'next/link';
type Props = { contact: { id: string; name: string; company: string | null; city: string | null; tags: { tag: { id: string; name: string; color: string | null } }[] } };
export function ContactCard({ contact }: Props) {
  return (
    <li className="rounded border p-3 hover:bg-gray-50"><Link href={`/contacts/${contact.id}`}><div className="flex items-center justify-between"><div><div className="font-medium">{contact.name}</div><div className="text-sm text-gray-500">{[contact.company, contact.city].filter(Boolean).join(' · ')}</div></div><div className="flex gap-1">{contact.tags.map(t => <span key={t.tag.id} className="rounded px-2 text-xs" style={{ background: t.tag.color ?? '#e5e7eb' }}>{t.tag.name}</span>)}</div></div></Link></li>
  );
}
```

- [ ] **Step 3: New + edit pages** — share `ContactForm`.

```tsx
// src/components/contact-form.tsx
'use client';
import { useFormState, useFormStatus } from 'react-dom';
import type { Tag } from '@prisma/client';
import { createContactAction, updateContactAction } from '@/app/contacts/actions';
const blank = { name: '', company: '', title: '', city: '', email: '', phone: '', wechat: '', birthdayMonth: '', birthdayDay: '', notes: '' };
type Initial = Partial<typeof blank> & { id?: string; tagIds?: string[] };
function Submit({ label }: { label: string }) { const { pending } = useFormStatus(); return <button disabled={pending} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">{label}</button>; }
export function ContactForm({ initial, tags, mode }: { initial?: Initial; tags: Tag[]; mode: 'create' | 'edit' }) {
  const action = mode === 'create' ? createContactAction : (mode === 'edit' && initial?.id) ? updateContactAction.bind(null, initial.id) : createContactAction;
  const [state, formAction] = useFormState(action as any, { ok: true, data: null });
  return (
    <form action={formAction} className="grid grid-cols-2 gap-3">
      <Field label="姓名 *" name="name" defaultValue={initial?.name} />
      <Field label="公司" name="company" defaultValue={initial?.company} />
      <Field label="职位" name="title" defaultValue={initial?.title} />
      <Field label="城市" name="city" defaultValue={initial?.city} />
      <Field label="邮箱" name="email" type="email" defaultValue={initial?.email} />
      <Field label="电话" name="phone" defaultValue={initial?.phone} />
      <Field label="微信" name="wechat" defaultValue={initial?.wechat} />
      <Field label="生日 月" name="birthdayMonth" type="number" min={1} max={12} defaultValue={initial?.birthdayMonth} />
      <Field label="生日 日" name="birthdayDay" type="number" min={1} max={31} defaultValue={initial?.birthdayDay} />
      <div className="col-span-2"><label className="block text-sm">标签</label><div className="mt-1 flex flex-wrap gap-2">{tags.map(t => <label key={t.id} className="rounded border px-2 py-1 text-sm"><input type="checkbox" name="tagId" value={t.id} defaultChecked={initial?.tagIds?.includes(t.id)} /> {t.name}</label>)}</div></div>
      <div className="col-span-2"><label className="block text-sm">备注</label><textarea name="notes" defaultValue={initial?.notes} className="mt-1 w-full rounded border p-2" rows={4} /></div>
      {state && !state.ok && <p className="col-span-2 text-red-600 text-sm">{state.error}</p>}
      <div className="col-span-2"><Submit label={mode === 'create' ? '创建' : '保存'} /></div>
    </form>
  );
}
function Field({ label, name, type='text', ...rest }: any) { return <div><label className="block text-sm">{label}</label><input name={name} type={type} className="mt-1 w-full rounded border p-2" {...rest} /></div>; }
```

- [ ] **Step 4: Detail page** — shows contact + tags + edit/delete buttons; placeholders for events/interactions (filled in later phases).

```tsx
// src/app/contacts/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ContactService } from '@/server/services/contact';
import { TagService } from '@/server/services/tag';
import { deleteContactAction } from '@/app/contacts/actions';
export default async function ContactDetail({ params }: { params: { id: string } }) {
  let c; try { c = await ContactService.get(params.id); } catch { notFound(); }
  const tags = await TagService.list();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{c.name}</h1><div className="flex gap-2"><Link className="rounded border px-3 py-1" href={`/contacts/${c.id}/edit`}>编辑</Link><form action={deleteContactAction.bind(null, c.id)}><button className="rounded border border-red-300 px-3 py-1 text-red-600">删除</button></form></div></div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">{[['公司', c.company], ['职位', c.title], ['城市', c.city], ['邮箱', c.email], ['电话', c.phone], ['微信', c.wechat], ['生日', c.birthdayMonth && c.birthdayDay ? `${c.birthdayMonth}-${c.birthdayDay}` : null]].map(([k, v]) => v ? <div key={k as string}><dt className="text-gray-500">{k}</dt><dd>{v}</dd></div> : null)}</dl>
      <div className="mt-3 flex gap-1">{c.tags.map(t => <span key={t.tag.id} className="rounded px-2 text-xs" style={{ background: t.tag.color ?? '#e5e7eb' }}>{t.tag.name}</span>)}</div>
      {c.notes && <section className="mt-6"><h2 className="font-semibold">备注</h2><p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{c.notes}</p></section>}
      <section className="mt-8"><h2 className="font-semibold">互动</h2><p className="text-sm text-gray-500">在 Phase 3 启用。</p></section>
    </main>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(contacts): list/new/detail/edit pages with tag picker"
```

### Task 1.6: Tag management page

**Files:** `src/app/tags/page.tsx`, `src/app/tags/actions.ts`.

- [ ] **Step 1: actions**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { TagService } from '@/server/services/tag';
export async function createTag(fd: FormData) { await TagService.create({ name: String(fd.get('name')), color: (fd.get('color') as string) || undefined }); revalidatePath('/tags'); revalidatePath('/contacts'); }
export async function renameTag(id: string, fd: FormData) { await TagService.rename(id, String(fd.get('name'))); revalidatePath('/tags'); }
export async function deleteTag(id: string) { await TagService.remove(id); revalidatePath('/tags'); revalidatePath('/contacts'); }
```

- [ ] **Step 2: page**

```tsx
import { TagService } from '@/server/services/tag';
import { createTag, renameTag, deleteTag } from './actions';
export default async function TagsPage() {
  const tags = await TagService.list();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">标签</h1>
      <form action={createTag} className="mt-4 flex gap-2"><input name="name" required placeholder="新标签" className="rounded border p-2 flex-1" /><input name="color" type="color" defaultValue="#2563eb" /><button className="rounded bg-accent px-3 text-white">添加</button></form>
      <ul className="mt-4 divide-y">{tags.map(t => <li key={t.id} className="flex items-center gap-3 py-2"><span className="rounded px-2 text-xs" style={{ background: t.color ?? '#e5e7eb' }}>{t.name}</span><span className="text-sm text-gray-500">{t._count.contacts} 人</span><form action={renameTag.bind(null, t.id)} className="ml-auto flex gap-1"><input name="name" defaultValue={t.name} className="rounded border p-1 text-sm" /><button className="rounded border px-2 text-sm">改名</button></form><form action={deleteTag.bind(null, t.id)}><button className="rounded border border-red-300 px-2 text-sm text-red-600">删除</button></form></li>)}</ul>
    </main>
  );
}
```

- [ ] **Step 3: Add nav + commit**

Update `src/app/layout.tsx` to include a top nav: 联系人 · 日程 · 需求 · 搜索 · 标签. Then:

```bash
pnpm test && git add -A && git commit -m "feat(tags): management page + nav"
```

---

## Phase 2 — Events + Calendar

### Task 2.1: Add Event / EventAttendee models

**Files:** `prisma/schema.prisma` (modify).

- [ ] **Step 1: Append models**

```prisma
model Event {
  id          String   @id @default(cuid())
  title       String
  type        String   @default("meeting") // meeting|birthday|anniversary|reminder|custom
  startAt     DateTime
  endAt       DateTime?
  location    String?
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  attendees   EventAttendee[]
  reminders   Reminder[]
  @@index([startAt])
}

model EventAttendee {
  eventId   String
  contactId String
  event     Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@id([eventId, contactId])
  @@index([contactId])
}
```

- [ ] **Step 2: Push + commit**

```bash
pnpm db:push && git add -A && git commit -m "feat(db): Event and EventAttendee models"
```

### Task 2.2: EventService — TDD

**Files:** `src/server/services/event.ts`, `src/server/services/event.test.ts`.

- [ ] **Step 1: Tests** — create with attendees, list between dates, update attendees diff, delete cascades.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { EventService } from './event';
import { ContactService } from './contact';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('EventService', () => {
  it('creates with attendees', async () => { const c = await ContactService.create({ name: 'A' }); const e = await EventService.create({ title: 'Coffee', startAt: new Date('2026-07-01T10:00:00Z'), attendeeIds: [c.id] }); expect(e.attendees).toHaveLength(1); });
  it('lists by month', async () => { await EventService.create({ title: 'A', startAt: new Date('2026-07-15T10:00:00Z') }); const r = await EventService.listByMonth(2026, 7); expect(r).toHaveLength(1); });
  it('updates attendees (diff)', async () => { const a = await ContactService.create({ name: 'A' }); const b = await ContactService.create({ name: 'B' }); const e = await EventService.create({ title: 'X', startAt: new Date(), attendeeIds: [a.id] }); await EventService.update(e.id, { attendeeIds: [b.id] }); const after = await EventService.get(e.id); expect(after!.attendees.map(at => at.contactId)).toEqual([b.id]); });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
const eventInput = z.object({
  title: z.string().min(1).max(120),
  type: z.enum(['meeting', 'birthday', 'anniversary', 'reminder', 'custom']).default('meeting'),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  location: z.string().max(200).nullish(),
  notes: z.string().max(8000).nullish(),
  attendeeIds: z.array(z.string()).default([]),
});
export const EventService = {
  async create(input: z.infer<typeof eventInput>) {
    const p = eventInput.parse(input);
    return prisma.event.create({ data: { title: p.title, type: p.type, startAt: p.startAt, endAt: p.endAt ?? null, location: p.location ?? null, notes: p.notes ?? null, attendees: { create: p.attendeeIds.map(id => ({ contactId: id })) } }, include: { attendees: true } });
  },
  async get(id: string) { const e = await prisma.event.findUnique({ where: { id }, include: { attendees: { include: { contact: true } } } }); if (!e) throw new NotFoundError('事件不存在'); return e; },
  async update(id: string, input: Partial<z.infer<typeof eventInput>>) {
    const p = eventInput.partial().parse(input);
    if (p.attendeeIds) { await prisma.eventAttendee.deleteMany({ where: { eventId: id } }); }
    return prisma.event.update({ where: { id }, data: { ...p, attendees: p.attendeeIds ? { create: p.attendeeIds.map(cid => ({ contactId: cid })) } : undefined }, include: { attendees: { include: { contact: true } } } });
  },
  async remove(id: string) { try { await prisma.event.delete({ where: { id } }); } catch { throw new NotFoundError('事件不存在'); } },
  async listByMonth(year: number, month1to12: number) {
    const start = new Date(Date.UTC(year, month1to12 - 1, 1));
    const end = new Date(Date.UTC(year, month1to12, 1));
    return prisma.event.findMany({ where: { startAt: { gte: start, lt: end } }, include: { attendees: { include: { contact: true } } }, orderBy: { startAt: 'asc' } });
  },
  async listByContact(contactId: string) { return prisma.event.findMany({ where: { attendees: { some: { contactId } } }, orderBy: { startAt: 'desc' }, take: 50, include: { attendees: { include: { contact: true } } } }); },
};
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm test event && git add -A && git commit -m "feat(events): EventService CRUD with attendees"
```

### Task 2.3: Calendar page using FullCalendar

**Files:** `src/app/calendar/page.tsx`, `src/components/calendar-view.tsx`, `src/app/calendar/actions.ts`.

- [ ] **Step 1: install fullcalendar**

```bash
pnpm add @fullcalendar/core@6.1.15 @fullcalendar/react@6.1.15 @fullcalendar/daygrid@6.1.15 @fullcalendar/timegrid@6.1.15 @fullcalendar/list@6.1.15 @fullcalendar/interaction@6.1.15
```

- [ ] **Step 2: actions**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { EventService } from '@/server/services/event';
function parse(fd: FormData) {
  return { title: String(fd.get('title') ?? ''), type: (fd.get('type') as any) ?? 'meeting', startAt: new Date(String(fd.get('startAt'))), endAt: fd.get('endAt') ? new Date(String(fd.get('endAt'))) : null, location: (fd.get('location') as string) || null, notes: (fd.get('notes') as string) || null, attendeeIds: fd.getAll('attendeeId').map(String).filter(Boolean) };
}
export async function createEventAction(fd: FormData) { const e = await EventService.create(parse(fd)); revalidatePath('/calendar'); redirect(`/events/${e.id}`); }
export async function updateEventAction(id: string, fd: FormData) { await EventService.update(id, parse(fd)); revalidatePath('/calendar'); revalidatePath(`/events/${id}`); redirect(`/events/${id}`); }
export async function deleteEventAction(id: string) { await EventService.remove(id); revalidatePath('/calendar'); redirect('/calendar'); }
```

- [ ] **Step 3: client view**

```tsx
// src/components/calendar-view.tsx
'use client';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { useRouter } from 'next/navigation';
type Ev = { id: string; title: string; start: string; end?: string | null; allDay?: boolean };
export function CalendarView({ events }: { events: Ev[] }) {
  const r = useRouter();
  return <FullCalendar plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView="dayGridMonth" locale="zh-cn" firstDay={1} headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }} events={events} eventClick={(arg) => r.push(`/events/${arg.event.id}`)} dateClick={(arg) => r.push(`/events/new?date=${arg.dateStr}`)} height="auto" />;
}
```

- [ ] **Step 4: page**

```tsx
// src/app/calendar/page.tsx
import Link from 'next/link';
import { EventService } from '@/server/services/event';
import { CalendarView } from '@/components/calendar-view';
export default async function CalendarPage({ searchParams }: { searchParams: { y?: string; m?: string } }) {
  const now = new Date(); const y = Number(searchParams.y ?? now.getFullYear()); const m = Number(searchParams.m ?? now.getMonth() + 1);
  const list = await EventService.listByMonth(y, m);
  const events = list.map(e => ({ id: e.id, title: e.title, start: e.startAt.toISOString(), end: e.endAt?.toISOString() ?? undefined }));
  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between"><h1 className="text-2xl font-semibold">日程 · {y}-{String(m).padStart(2,'0')}</h1><Link href={`/events/new`} className="rounded bg-accent px-3 py-1.5 text-white">新建</Link></div>
      <CalendarView events={events} />
    </main>
  );
}
```

- [ ] **Step 5: New + edit + detail event pages**

```tsx
// src/app/events/new/page.tsx
import { ContactService } from '@/server/services/contact';
import { EventForm } from '@/components/event-form';
import { createEventAction } from '@/app/calendar/actions';
export default async function NewEvent({ searchParams }: { searchParams: { date?: string } }) {
  const contacts = await ContactService.list({});
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">新建事件</h1><EventForm action={createEventAction} contacts={contacts} defaultStart={searchParams.date} /></main>;
}
```

```tsx
// src/app/events/[id]/edit/page.tsx
import { notFound } from 'next/navigation';
import { EventService } from '@/server/services/event';
import { ContactService } from '@/server/services/contact';
import { EventForm } from '@/components/event-form';
import { updateEventAction, deleteEventAction } from '@/app/calendar/actions';
export default async function EditEvent({ params }: { params: { id: string } }) {
  let e; try { e = await EventService.get(params.id); } catch { notFound(); }
  const contacts = await ContactService.list({});
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">编辑：{e.title}</h1><EventForm action={updateEventAction.bind(null, e.id)} contacts={contacts} initial={e} /><form action={deleteEventAction.bind(null, e.id)} className="mt-6"><button className="rounded border border-red-300 px-3 py-1 text-red-600">删除</button></form></main>;
}
```

```tsx
// src/app/events/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventService } from '@/server/services/event';
export default async function EventDetail({ params }: { params: { id: string } }) {
  let e; try { e = await EventService.get(params.id); } catch { notFound(); }
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{e.title}</h1><Link className="rounded border px-3 py-1" href={`/events/${e.id}/edit`}>编辑</Link></div>
      <p className="mt-2 text-sm text-gray-500">{e.type} · {e.startAt.toLocaleString('zh-CN')} {e.endAt ? `– ${e.endAt.toLocaleString('zh-CN')}` : ''}</p>
      {e.location && <p className="mt-1 text-sm">📍 {e.location}</p>}
      <section className="mt-4"><h2 className="font-semibold">参与人</h2>{e.attendees.length === 0 ? <p className="text-sm text-gray-500">无</p> : <ul className="mt-2 grid gap-1">{e.attendees.map(a => <li key={a.contactId}><Link className="text-sm text-accent" href={`/contacts/${a.contact.id}`}>{a.contact.name}</Link></li>)}</ul>}</section>
      {e.notes && <section className="mt-6"><h2 className="font-semibold">备注</h2><p className="mt-1 whitespace-pre-wrap text-sm">{e.notes}</p></section>}
    </main>
  );
}
```

```tsx
// src/components/event-form.tsx
'use client';
import { EventFormProps } from './event-form-types';
export function EventForm({ action, contacts, initial, defaultStart }: EventFormProps) {
  const start = initial?.startAt ? new Date(initial.startAt).toISOString().slice(0, 16) : defaultStart ?? '';
  return (
    <form action={action} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="text-sm">标题 *</label><input name="title" required defaultValue={initial?.title} className="mt-1 w-full rounded border p-2" /></div>
      <div><label className="text-sm">类型</label><select name="type" defaultValue={initial?.type ?? 'meeting'} className="mt-1 w-full rounded border p-2"><option value="meeting">会面</option><option value="birthday">生日</option><option value="anniversary">纪念日</option><option value="reminder">提醒</option><option value="custom">其他</option></select></div>
      <div><label className="text-sm">地点</label><input name="location" defaultValue={initial?.location ?? ''} className="mt-1 w-full rounded border p-2" /></div>
      <div><label className="text-sm">开始 *</label><input name="startAt" type="datetime-local" required defaultValue={start} className="mt-1 w-full rounded border p-2" /></div>
      <div><label className="text-sm">结束</label><input name="endAt" type="datetime-local" defaultValue={initial?.endAt ? new Date(initial.endAt).toISOString().slice(0, 16) : ''} className="mt-1 w-full rounded border p-2" /></div>
      <div className="col-span-2"><label className="text-sm">参与人</label><div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border p-2">{contacts.map(c => <label key={c.id} className="text-sm"><input type="checkbox" name="attendeeId" value={c.id} defaultChecked={initial?.attendees?.some(a => a.contactId === c.id)} /> {c.name}</label>)}</div></div>
      <div className="col-span-2"><label className="text-sm">备注</label><textarea name="notes" defaultValue={initial?.notes ?? ''} className="mt-1 w-full rounded border p-2" rows={4} /></div>
      <div className="col-span-2"><button className="rounded bg-accent px-4 py-2 text-white">保存</button></div>
    </form>
  );
}
```

```ts
// src/components/event-form-types.ts
import type { Event, Contact } from '@prisma/client';
export interface EventFormProps {
  action: (fd: FormData) => Promise<any>;
  contacts: Pick<Contact, 'id' | 'name'>[];
  initial?: Event & { attendees: { contactId: string }[] };
  defaultStart?: string;
}
```

- [ ] **Step 6: Commit**

```bash
pnpm test && git add -A && git commit -m "feat(calendar): FullCalendar month/week/list with event create/edit/detail"
```

---

## Phase 3 — Interactions

### Task 3.1: Interaction model

**Files:** `prisma/schema.prisma` (modify).

- [ ] **Step 1: Append model**

```prisma
model Interaction {
  id        String   @id @default(cuid())
  contactId String
  contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  occurredAt DateTime
  channel   String?  // 微信/电话/线下/邮件/...
  summary   String
  createdAt DateTime @default(now())
  @@index([contactId, occurredAt])
}
```

- [ ] **Step 2: Push + commit**

```bash
pnpm db:push && git add -A && git commit -m "feat(db): Interaction model"
```

### Task 3.2: InteractionService — TDD

**Files:** `src/server/services/interaction.ts`, `src/server/services/interaction.test.ts`.

- [ ] **Step 1: Tests** — create updates `lastContactedAt`; list by contact desc; delete.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { InteractionService } from './interaction';
import { ContactService } from './contact';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('InteractionService', () => {
  it('updates lastContactedAt to most recent', async () => { const c = await ContactService.create({ name: 'A' }); await InteractionService.log({ contactId: c.id, occurredAt: new Date('2026-01-01'), summary: '1' }); await InteractionService.log({ contactId: c.id, occurredAt: new Date('2026-02-01'), summary: '2' }); const after = await testDb().contact.findUnique({ where: { id: c.id } }); expect(after?.lastContactedAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z'); });
  it('lists desc', async () => { const c = await ContactService.create({ name: 'A' }); await InteractionService.log({ contactId: c.id, occurredAt: new Date('2026-01-01'), summary: 'old' }); await InteractionService.log({ contactId: c.id, occurredAt: new Date('2026-03-01'), summary: 'new' }); const r = await InteractionService.list(c.id); expect(r[0].summary).toBe('new'); });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
const input = z.object({ contactId: z.string(), occurredAt: z.coerce.date(), channel: z.string().max(40).nullish(), summary: z.string().min(1).max(4000) });
export const InteractionService = {
  async log(i: z.infer<typeof input>) {
    const p = input.parse(i);
    const inter = await prisma.interaction.create({ data: p });
    const latest = await prisma.interaction.findFirst({ where: { contactId: p.contactId }, orderBy: { occurredAt: 'desc' } });
    await prisma.contact.update({ where: { id: p.contactId }, data: { lastContactedAt: latest?.occurredAt ?? null } });
    return inter;
  },
  async list(contactId: string) { return prisma.interaction.findMany({ where: { contactId }, orderBy: { occurredAt: 'desc' }, take: 200 }); },
  async remove(id: string) { const i = await prisma.interaction.delete({ where: { id } }); const latest = await prisma.interaction.findFirst({ where: { contactId: i.contactId }, orderBy: { occurredAt: 'desc' } }); await prisma.contact.update({ where: { id: i.contactId }, data: { lastContactedAt: latest?.occurredAt ?? null } }); },
};
```

- [ ] **Step 3: Test pass + commit**

```bash
pnpm test interaction && git add -A && git commit -m "feat(interactions): service updates lastContactedAt"
```

### Task 3.3: Interaction UI

**Files:** `src/app/contacts/[id]/actions.ts`, `src/app/contacts/[id]/page.tsx` (modify — replace Phase 1 placeholder), `src/components/interaction-form.tsx`, `src/components/interaction-timeline.tsx`.

- [ ] **Step 1: actions**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { InteractionService } from '@/server/services/interaction';
import { EventService } from '@/server/services/event';
export async function logInteractionAction(contactId: string, fd: FormData) {
  await InteractionService.log({ contactId, occurredAt: new Date(String(fd.get('occurredAt'))), channel: (fd.get('channel') as string) || null, summary: String(fd.get('summary')) });
  revalidatePath(`/contacts/${contactId}`);
}
export async function deleteInteractionAction(contactId: string, id: string) { await InteractionService.remove(id); revalidatePath(`/contacts/${contactId}`); }
```

- [ ] **Step 2: form + timeline**

```tsx
// src/components/interaction-form.tsx
'use client';
import { useFormStatus } from 'react-dom';
import { logInteractionAction } from '@/app/contacts/[id]/actions';
function B({ children }: any) { const { pending } = useFormStatus(); return <button disabled={pending} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">{children}</button>; }
export function InteractionForm({ contactId }: { contactId: string }) {
  const today = new Date().toISOString().slice(0, 16);
  return (
    <form action={logInteractionAction.bind(null, contactId)} className="mt-3 grid grid-cols-3 gap-2 rounded border p-3 text-sm">
      <input name="occurredAt" type="datetime-local" required defaultValue={today} className="rounded border p-1.5" />
      <input name="channel" placeholder="渠道（微信/电话/线下…）" className="rounded border p-1.5" />
      <div className="col-span-3 flex gap-2"><input name="summary" required placeholder="本次互动概要" className="flex-1 rounded border p-1.5" /><B>记录</B></div>
    </form>
  );
}
```

```tsx
// src/components/interaction-timeline.tsx
'use client';
import { deleteInteractionAction } from '@/app/contacts/[id]/actions';
export function Timeline({ contactId, items }: { contactId: string; items: { id: string; occurredAt: string; channel: string | null; summary: string }[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">还没有互动记录</p>;
  return (
    <ol className="mt-3 space-y-2">
      {items.map(i => (
        <li key={i.id} className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between text-xs text-gray-500"><span>{new Date(i.occurredAt).toLocaleString('zh-CN')} {i.channel ? `· ${i.channel}` : ''}</span><form action={deleteInteractionAction.bind(null, contactId, i.id)}><button className="text-red-600">删除</button></form></div>
          <p className="mt-1 whitespace-pre-wrap">{i.summary}</p>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: integrate into contact detail**

Replace the placeholder section in `src/app/contacts/[id]/page.tsx` with:

```tsx
import { InteractionService } from '@/server/services/interaction';
import { EventService } from '@/server/services/event';
import { InteractionForm } from '@/components/interaction-form';
import { Timeline } from '@/components/interaction-timeline';
// inside the page, after </section> for notes:
const [interactions, events] = await Promise.all([InteractionService.list(c.id), EventService.listByContact(c.id)]);
<section className="mt-8">
  <h2 className="font-semibold">互动时间线</h2>
  <InteractionForm contactId={c.id} />
  <Timeline contactId={c.id} items={interactions.map(i => ({ id: i.id, occurredAt: i.occurredAt.toISOString(), channel: i.channel, summary: i.summary }))} />
</section>
<section className="mt-8">
  <h2 className="font-semibold">相关事件</h2>
  {events.length === 0 ? <p className="text-sm text-gray-500">无</p> : <ul className="mt-2 space-y-1">{events.map(e => <li key={e.id}><a className="text-sm text-accent" href={`/events/${e.id}`}>{e.title} · {e.startAt.toLocaleString('zh-CN')}</a></li>)}</ul>}
</section>
```

- [ ] **Step 4: Commit**

```bash
pnpm test && git add -A && git commit -m "feat(contacts): interaction timeline + related events"
```

---

## Phase 4 — Needs Kanban

### Task 4.1: Need model

**Files:** `prisma/schema.prisma` (modify).

- [ ] **Step 1: Append model**

```prisma
model Need {
  id          String   @id @default(cuid())
  title       String
  description String?
  category    String   // 交流|合作|咨询|介绍|帮忙|其他
  status      String   @default("open") // open|matched|in_progress|closed|cancelled
  priority    Int      @default(0)
  contactId   String?
  contact     Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  closedAt    DateTime?
  @@index([status])
  @@index([category])
  @@index([contactId])
}
```

- [ ] **Step 2: Push + commit**

```bash
pnpm db:push && git add -A && git commit -m "feat(db): Need model with status/category"
```

### Task 4.2: NeedService — TDD

**Files:** `src/server/services/need.ts`, `src/server/services/need.test.ts`.

- [ ] **Step 1: Tests** — create, transition (open→matched→in_progress→closed), assign contact, listByStatus.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { NeedService } from './need';
import { ContactService } from './contact';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('NeedService', () => {
  it('creates with default status open', async () => { const n = await NeedService.create({ title: '找前端', category: '合作' }); expect(n.status).toBe('open'); });
  it('transitions through pipeline', async () => { const n = await NeedService.create({ title: 'A', category: '合作' }); await NeedService.transition(n.id, 'matched'); await NeedService.transition(n.id, 'in_progress'); const c = await NeedService.transition(n.id, 'closed'); expect(c.closedAt).toBeTruthy(); });
  it('assigns contact and sets matched', async () => { const c = await ContactService.create({ name: 'X' }); const n = await NeedService.create({ title: 'A', category: '合作' }); const u = await NeedService.assignContact(n.id, c.id); expect(u.contactId).toBe(c.id); expect(u.status).toBe('matched'); });
  it('grouped by status', async () => { await NeedService.create({ title: 'A', category: '交流' }); const g = await NeedService.kanban(); expect(g.open.length).toBe(1); });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
const STATUS = ['open', 'matched', 'in_progress', 'closed', 'cancelled'] as const;
const CATEGORY = ['交流', '合作', '咨询', '介绍', '帮忙', '其他'] as const;
const create = z.object({ title: z.string().min(1).max(120), description: z.string().max(4000).nullish(), category: z.enum(CATEGORY), priority: z.number().int().min(0).max(10).default(0), contactId: z.string().nullish() });
const update = create.partial();
export const NeedService = {
  CATEGORIES: CATEGORY, STATUSES: STATUS,
  async create(input: z.infer<typeof create>) { return prisma.need.create({ data: create.parse(input) }); },
  async update(id: string, input: z.infer<typeof update>) {
    try { return await prisma.need.update({ where: { id }, data: update.parse(input) }); }
    catch { throw new NotFoundError('需求不存在'); }
  },
  async remove(id: string) { try { await prisma.need.delete({ where: { id } }); } catch { throw new NotFoundError('需求不存在'); } },
  async transition(id: string, to: typeof STATUS[number]) {
    if (!STATUS.includes(to)) throw new ValidationError('非法状态');
    const data: any = { status: to };
    if (to === 'closed') data.closedAt = new Date();
    try { return await prisma.need.update({ where: { id }, data }); }
    catch { throw new NotFoundError('需求不存在'); }
  },
  async assignContact(id: string, contactId: string) {
    try { return await prisma.need.update({ where: { id }, data: { contactId, status: 'matched' } }); }
    catch { throw new NotFoundError('需求不存在'); }
  },
  async kanban() {
    const all = await prisma.need.findMany({ include: { contact: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    const groups: Record<string, typeof all> = { open: [], matched: [], in_progress: [], closed: [], cancelled: [] };
    for (const n of all) groups[n.status]?.push(n);
    return groups;
  },
  async list() { return prisma.need.findMany({ include: { contact: true }, orderBy: { createdAt: 'desc' } }); },
  async get(id: string) { const n = await prisma.need.findUnique({ where: { id }, include: { contact: true } }); if (!n) throw new NotFoundError('需求不存在'); return n; },
};
```

- [ ] **Step 3: Test + commit**

```bash
pnpm test need && git add -A && git commit -m "feat(needs): NeedService kanban + transitions"
```

### Task 4.3: Need pages + Kanban

**Files:** `src/app/needs/page.tsx`, `src/app/needs/new/page.tsx`, `src/app/needs/[id]/page.tsx`, `src/app/needs/[id]/edit/page.tsx`, `src/app/needs/actions.ts`, `src/components/need-kanban.tsx`, `src/components/need-form.tsx`.

- [ ] **Step 1: actions**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NeedService } from '@/server/services/need';
function parse(fd: FormData) { return { title: String(fd.get('title') ?? ''), description: (fd.get('description') as string) || null, category: String(fd.get('category')) as any, priority: Number(fd.get('priority') ?? 0), contactId: (fd.get('contactId') as string) || null }; }
export async function createNeed(fd: FormData) { const n = await NeedService.create(parse(fd) as any); revalidatePath('/needs'); redirect(`/needs/${n.id}`); }
export async function updateNeed(id: string, fd: FormData) { await NeedService.update(id, parse(fd) as any); revalidatePath('/needs'); revalidatePath(`/needs/${id}`); redirect(`/needs/${id}`); }
export async function transitionNeed(id: string, to: string) { await NeedService.transition(id, to as any); revalidatePath('/needs'); revalidatePath(`/needs/${id}`); }
export async function moveNeed(id: string, to: string) { await NeedService.transition(id, to as any); revalidatePath('/needs'); }
export async function assignNeed(id: string, fd: FormData) { await NeedService.assignContact(id, String(fd.get('contactId'))); revalidatePath('/needs'); revalidatePath(`/needs/${id}`); }
export async function deleteNeed(id: string) { await NeedService.remove(id); revalidatePath('/needs'); redirect('/needs'); }
```

- [ ] **Step 2: form (shared)**

```tsx
// src/components/need-form.tsx
'use client';
import { NeedService } from '@/server/services/need';
export function NeedForm({ action, contacts, initial }: { action: (fd: FormData) => Promise<any>; contacts: { id: string; name: string }[]; initial?: any }) {
  return (
    <form action={action} className="mt-4 grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="text-sm">标题 *</label><input name="title" required defaultValue={initial?.title} className="mt-1 w-full rounded border p-2" /></div>
      <div><label className="text-sm">分类 *</label><select name="category" defaultValue={initial?.category ?? '合作'} className="mt-1 w-full rounded border p-2">{NeedService.CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
      <div><label className="text-sm">优先级 (0-10)</label><input name="priority" type="number" min={0} max={10} defaultValue={initial?.priority ?? 0} className="mt-1 w-full rounded border p-2" /></div>
      <div className="col-span-2"><label className="text-sm">描述</label><textarea name="description" defaultValue={initial?.description ?? ''} rows={4} className="mt-1 w-full rounded border p-2" /></div>
      <div className="col-span-2"><label className="text-sm">关联联系人（可选）</label><select name="contactId" defaultValue={initial?.contactId ?? ''} className="mt-1 w-full rounded border p-2"><option value="">无</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="col-span-2"><button className="rounded bg-accent px-4 py-2 text-white">保存</button></div>
    </form>
  );
}
```

- [ ] **Step 3: Kanban (HTML5 drag-and-drop)**

```tsx
// src/components/need-kanban.tsx
'use client';
import Link from 'next/link';
import { moveNeed } from '@/app/needs/actions';
type Need = { id: string; title: string; category: string; contact: { id: string; name: string } | null };
const COLS = [{ key: 'open', label: '待办' }, { key: 'matched', label: '已匹配' }, { key: 'in_progress', label: '进行中' }, { key: 'closed', label: '已关闭' }] as const;
export function Kanban({ groups }: { groups: Record<string, Need[]> }) {
  function onDragStart(e: React.DragEvent, id: string) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }
  async function onDrop(e: React.DragEvent, to: string) { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) await moveNeed(id, to); }
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-4">
      {COLS.map(col => (
        <section key={col.key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, col.key)} className="rounded border bg-gray-50 p-3 min-h-[60vh]">
          <header className="mb-2 flex items-center justify-between text-sm font-semibold"><span>{col.label}</span><span className="rounded bg-white px-2 text-xs text-gray-500">{groups[col.key]?.length ?? 0}</span></header>
          <ul className="space-y-2">
            {(groups[col.key] ?? []).map(n => (
              <li key={n.id} draggable onDragStart={(e) => onDragStart(e, n.id)} className="cursor-move rounded border bg-white p-2 text-sm shadow-sm">
                <Link className="font-medium text-accent" href={`/needs/${n.id}`}>{n.title}</Link>
                <div className="mt-1 flex items-center justify-between text-xs text-gray-500"><span>{n.category}</span>{n.contact && <span>→ {n.contact.name}</span>}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: pages**

```tsx
// src/app/needs/page.tsx
import Link from 'next/link';
import { NeedService } from '@/server/services/need';
import { Kanban } from '@/components/need-kanban';
export default async function NeedsPage() {
  const groups = await NeedService.kanban();
  const flat = Object.values(groups).flat();
  const safeGroups: any = { open: [], matched: [], in_progress: [], closed: [], cancelled: [] };
  for (const c of Object.keys(groups)) safeGroups[c] = (groups as any)[c].map((n: any) => ({ id: n.id, title: n.title, category: n.category, contact: n.contact ? { id: n.contact.id, name: n.contact.name } : null }));
  return (<main className="mx-auto max-w-6xl p-6"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">需求看板 · {flat.length} 项</h1><Link className="rounded bg-accent px-3 py-1.5 text-white" href="/needs/new">新建</Link></div><Kanban groups={safeGroups} /></main>);
}
```

```tsx
// src/app/needs/new/page.tsx
import { ContactService } from '@/server/services/contact';
import { NeedForm } from '@/components/need-form';
import { createNeed } from '@/app/needs/actions';
export default async function NewNeed() {
  const contacts = (await ContactService.list({})).map(c => ({ id: c.id, name: c.name }));
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">新建需求</h1><NeedForm action={createNeed} contacts={contacts} /></main>;
}
```

```tsx
// src/app/needs/[id]/page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { NeedService } from '@/server/services/need';
import { ContactService } from '@/server/services/contact';
import { transitionNeed, assignNeed, deleteNeed } from '@/app/needs/actions';
const NEXT: Record<string, string | null> = { open: 'matched', matched: 'in_progress', in_progress: 'closed', closed: null, cancelled: null };
export default async function NeedDetail({ params }: { params: { id: string } }) {
  let n; try { n = await NeedService.get(params.id); } catch { notFound(); }
  const contacts = (await ContactService.list({})).map(c => ({ id: c.id, name: c.name }));
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">{n.title}</h1><div className="flex gap-2"><Link className="rounded border px-3 py-1" href={`/needs/${n.id}/edit`}>编辑</Link><form action={deleteNeed.bind(null, n.id)}><button className="rounded border border-red-300 px-3 py-1 text-red-600">删除</button></form></div></div>
      <p className="mt-1 text-sm text-gray-500">{n.category} · {n.status} · 优先级 {n.priority}</p>
      {n.description && <p className="mt-3 whitespace-pre-wrap text-sm">{n.description}</p>}
      <section className="mt-6"><h2 className="font-semibold">关联联系人</h2>{n.contact ? <p>{n.contact.name} <Link className="ml-2 text-sm text-accent" href={`/contacts/${n.contact.id}`}>查看 →</Link></p> : <form action={assignNeed.bind(null, n.id)} className="flex gap-2"><select name="contactId" required className="rounded border p-1.5"><option value="">选择联系人</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="rounded border px-2 text-sm">关联</button></form>}</section>
      {NEXT[n.status] && <form action={transitionNeed.bind(null, n.id, NEXT[n.status]!)} className="mt-4"><button className="rounded bg-accent px-3 py-1.5 text-white text-sm">推进 → {NEXT[n.status]}</button></form>}
    </main>
  );
}
```

```tsx
// src/app/needs/[id]/edit/page.tsx
import { notFound } from 'next/navigation';
import { NeedService } from '@/server/services/need';
import { ContactService } from '@/server/services/contact';
import { NeedForm } from '@/components/need-form';
import { updateNeed } from '@/app/needs/actions';
export default async function EditNeed({ params }: { params: { id: string } }) {
  let n; try { n = await NeedService.get(params.id); } catch { notFound(); }
  const contacts = (await ContactService.list({})).map(c => ({ id: c.id, name: c.name }));
  return <main className="mx-auto max-w-2xl p-6"><h1 className="text-2xl font-semibold">编辑：{n.title}</h1><NeedForm action={updateNeed.bind(null, n.id)} contacts={contacts} initial={n} /></main>;
}
```

- [ ] **Step 5: Commit**

```bash
pnpm test && git add -A && git commit -m "feat(needs): kanban + create/detail/edit with drag-and-drop"
```

---

## Phase 5 — Natural-Language Search

### Task 5.1: FTS5 virtual table + triggers

**Files:** `prisma/sql/fts5.sql`, `prisma/sql/apply.ts`.

- [ ] **Step 1: SQL**

```sql
-- prisma/sql/fts5.sql
DROP TABLE IF EXISTS contact_fts;
CREATE VIRTUAL TABLE contact_fts USING fts5(
  name, company, title, city, email, phone, wechat, notes,
  content='', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER contact_ai AFTER INSERT ON Contact BEGIN
  INSERT INTO contact_fts(rowid, name, company, title, city, email, phone, wechat, notes)
  VALUES (new.rowid, COALESCE(new.name,''), COALESCE(new.company,''), COALESCE(new.title,''), COALESCE(new.city,''), COALESCE(new.email,''), COALESCE(new.phone,''), COALESCE(new.wechat,''), COALESCE(new.notes,''));
END;
CREATE TRIGGER contact_ad AFTER DELETE ON Contact BEGIN DELETE FROM contact_fts WHERE rowid = old.rowid; END;
CREATE TRIGGER contact_au AFTER UPDATE ON Contact BEGIN
  DELETE FROM contact_fts WHERE rowid = old.rowid;
  INSERT INTO contact_fts(rowid, name, company, title, city, email, phone, wechat, notes)
  VALUES (new.rowid, COALESCE(new.name,''), COALESCE(new.company,''), COALESCE(new.title,''), COALESCE(new.city,''), COALESCE(new.email,''), COALESCE(new.phone,''), COALESCE(new.wechat,''), COALESCE(new.notes,''));
END;
```

- [ ] **Step 2: Apply script**

```ts
// prisma/sql/apply.ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const path = url.replace(/^file:/, '');
const db = new Database(path);
db.exec(readFileSync(join(__dirname, 'fts5.sql'), 'utf8'));
console.log('fts5 applied');
```

- [ ] **Step 3: Run + commit**

```bash
pnpm add -D better-sqlite3@11.3.0 @types/better-sqlite3@7.6.11
pnpm db:push
pnpm exec tsx prisma/sql/apply.ts
git add -A && git commit -m "feat(search): FTS5 virtual table + apply script"
```

### Task 5.2: NL parser — TDD

**Files:** `src/server/search/parser.ts`, `src/server/search/parser.test.ts`.

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseQuery } from './parser';
describe('parseQuery', () => {
  it('parses city + category', () => { const r = parseQuery('北京 创业 找前端'); expect(r.city).toBe('北京'); expect(r.text).toContain('创业'); expect(r.text).toContain('找前端'); });
  it('handles only text', () => { const r = parseQuery('张三'); expect(r.text).toBe('张三'); });
  it('emits structured chips', () => { const r = parseQuery('上海 合作 介绍投资人'); expect(r.chips.some(c => c.kind === 'city' && c.value === '上海')).toBe(true); expect(r.chips.some(c => c.kind === 'category' && c.value === '合作')).toBe(true); });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/search/parser.ts
export const KNOWN_CITIES = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '苏州', '西安', '重庆', '天津', '厦门', '青岛'];
export const KNOWN_CATEGORIES = ['交流', '合作', '咨询', '介绍', '帮忙', '其他'];
export type Chip = { kind: 'city' | 'category' | 'tag' | 'free'; value: string };
export type Parsed = { text: string; city?: string; category?: string; chips: Chip[] };
export function parseQuery(q: string): Parsed {
  const chips: Chip[] = []; const tokens = q.trim().split(/\s+/).filter(Boolean); const remaining: string[] = [];
  let city: string | undefined; let category: string | undefined;
  for (const t of tokens) {
    if (!city && KNOWN_CITIES.includes(t)) { city = t; chips.push({ kind: 'city', value: t }); continue; }
    if (!category && KNOWN_CATEGORIES.includes(t)) { category = t; chips.push({ kind: 'category', value: t }); continue; }
    if (t.startsWith('#') && t.length > 1) { chips.push({ kind: 'tag', value: t.slice(1) }); continue; }
    remaining.push(t);
  }
  return { text: remaining.join(' ').trim(), city, category, chips };
}
```

- [ ] **Step 3: Test + commit**

```bash
pnpm test parser && git add -A && git commit -m "feat(search): NL parser with city/category detection"
```

### Task 5.3: SearchService + /api/search

**Files:** `src/server/search/executor.ts`, `src/server/search/search-service.ts`, `src/app/api/search/route.ts`, `src/server/search/executor.test.ts`.

- [ ] **Step 1: executor**

```ts
// src/server/search/executor.ts
import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
import type { Parsed } from './parser';
const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
function raw() { return new Database(url.replace(/^file:/, ''), { readonly: false }); }
function ftsQuery(text: string): string {
  if (!text) return '';
  return text.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '""')}"*`).join(' ');
}
export type Hit = { id: string; snippet: string };
export async function executeSearch(parsed: Parsed): Promise<Hit[]> {
  const q = ftsQuery(parsed.text);
  const idsFromFts: string[] = [];
  if (q) {
    const db = raw();
    try {
      const rows = db.prepare(
        `SELECT c.id, snippet(contact_fts, 0, '<mark>', '</mark>', '…', 16) AS snip
         FROM contact_fts
         JOIN Contact c ON c.rowid = contact_fts.rowid
         WHERE contact_fts MATCH ?
         LIMIT 200`
      ).all(q) as any[];
      for (const r of rows) idsFromFts.push(r.id);
    } finally { db.close(); }
  }
  const where: any = {};
  if (idsFromFts.length) where.id = { in: idsFromFts };
  if (parsed.city) where.city = parsed.city;
  let candidates = await prisma.contact.findMany({ where, include: { tags: { include: { tag: true } } }, orderBy: { updatedAt: 'desc' }, take: 200 });
  if (candidates.length === 0 && parsed.text) {
    candidates = await prisma.contact.findMany({
      where: { OR: [{ name: { contains: parsed.text } }, { company: { contains: parsed.text } }, { notes: { contains: parsed.text } }] },
      take: 200, include: { tags: { include: { tag: true } } }, orderBy: { updatedAt: 'desc' },
    });
  }
  return candidates.map(c => ({ id: c.id, snippet: c.name + (c.company ? ` · ${c.company}` : '') + (c.city ? ` · ${c.city}` : '') }));
}
```

- [ ] **Step 2: search service**

```ts
// src/server/search/search-service.ts
import { parseQuery } from './parser';
import { executeSearch } from './executor';
export const SearchService = { async run(q: string) { const p = parseQuery(q); const hits = await executeSearch(p); return { parsed: p, hits }; } };
```

- [ ] **Step 3: route**

```ts
// src/app/api/search/route.ts
import { NextRequest } from 'next/server';
import { SearchService } from '@/server/search/search-service';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (!q.trim()) return Response.json({ hits: [], parsed: { text: '', chips: [] } });
  const r = await SearchService.run(q);
  return Response.json(r);
}
```

- [ ] **Step 4: end-to-end executor test** (`executor.test.ts`) — seeds 2 contacts (one city=北京, company contains '创业'), queries `'北京 创业'`, asserts city filter applied.

- [ ] **Step 5: Commit**

```bash
pnpm test search && git add -A && git commit -m "feat(search): SearchService + /api/search route"
```

### Task 5.4: Search UI

**Files:** `src/app/search/page.tsx`, `src/components/search-bar.tsx`, `src/components/search-results.tsx`. Add SearchBar to `src/app/layout.tsx`.

- [ ] **Step 1: search-results client**

```tsx
// src/components/search-results.tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
type Hit = { id: string; snippet: string };
type Parsed = { text: string; city?: string; category?: string; chips: { kind: string; value: string }[] };
export function SearchResults({ q }: { q: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: async () => {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q));
      return r.json() as Promise<{ hits: Hit[]; parsed: Parsed }>;
    },
  });
  if (!q) return <p className="mt-6 text-sm text-gray-500">试着输入「北京 合作 找前端」之类的描述。</p>;
  if (isLoading) return <p className="mt-6 text-sm">搜索中…</p>;
  if (!data) return null;
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2 text-xs">{data.parsed.chips.map((c, i) => <span key={i} className="rounded bg-accent/10 px-2 py-1 text-accent">{c.kind}: {c.value}</span>)}</div>
      {data.hits.length === 0 ? <p className="mt-4 text-sm text-gray-500">没有匹配。</p> : <ul className="mt-4 space-y-2">{data.hits.map(h => <li key={h.id} className="rounded border p-3 text-sm"><Link className="font-medium text-accent" href={`/contacts/${h.id}`}>{h.snippet}</Link></li>)}</ul>}
    </div>
  );
}
```

- [ ] **Step 2: search-bar**

```tsx
// src/components/search-bar.tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
export function SearchBar() {
  const r = useRouter(); const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  return (
    <form onSubmit={(e) => { e.preventDefault(); r.push('/search?q=' + encodeURIComponent(q)); }} className="flex gap-1">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 例：北京 合作 找前端" className="rounded border px-2 py-1 text-sm w-72" />
      <button className="rounded border px-2 text-sm">搜索</button>
    </form>
  );
}
```

- [ ] **Step 3: search page**

```tsx
// src/app/search/page.tsx
import { SearchBar } from '@/components/search-bar';
import { SearchResults } from '@/components/search-results';
export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  return (<main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">搜索</h1><SearchBar /><SearchResults q={searchParams.q ?? ''} /></main>);
}
```

- [ ] **Step 4: add SearchBar to layout nav** — modify `src/app/layout.tsx` to render `<header className="border-b p-3 flex gap-4 items-center"><Link className="font-bold" href="/">PRM</Link><Link href="/contacts">联系人</Link><Link href="/calendar">日程</Link><Link href="/needs">需求</Link><Link href="/tags">标签</Link><Link href="/inbox">收件箱</Link><div className="ml-auto"><SearchBar /></div></header>` before `{children}`.

- [ ] **Step 5: Commit**

```bash
pnpm test && git add -A && git commit -m "feat(search): search page + nav bar + chips"
```

---

## Phase 6 — Reminders + Push + Birthday

### Task 6.1: Reminder + InboxItem + PushSubscription models

**Files:** `prisma/schema.prisma` (modify), `prisma/sql/push.sql`.

- [ ] **Step 1: Append Prisma models**

```prisma
model Reminder {
  id          String   @id @default(cuid())
  contactId   String?
  contact     Contact? @relation("ContactReminders", fields: [contactId], references: [id], onDelete: Cascade)
  eventId     String?
  event       Event?   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  triggerAt   DateTime
  offsets     String   @default("[60,1440]") // JSON array of minutes before trigger event
  kind        String   @default("event") // event|birthday|stale
  dispatched  Boolean  @default(false)
  dismissed   Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([triggerAt, dispatched, dismissed])
  @@index([contactId])
}

model InboxItem {
  id          String   @id @default(cuid())
  kind        String   // reminder_due|reminder_dismissed|system
  title       String
  body        String
  link        String?
  read        Boolean  @default(false)
  createdAt   DateTime @default(now())
  @@index([read, createdAt])
}
```

- [ ] **Step 2: PushSubscription (raw SQL — out of Prisma)**

```sql
-- prisma/sql/push.sql
CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
```

- [ ] **Step 3: Push + commit**

```bash
pnpm db:push
sqlite3 prisma/dev.db < prisma/sql/push.sql || pnpm exec tsx -e "import Database from 'better-sqlite3'; const db = new Database('./prisma/dev.db'); db.exec(require('fs').readFileSync('./prisma/sql/push.sql','utf8')); console.log('ok');"
git add -A && git commit -m "feat(db): Reminder, InboxItem, push_subscription"
```

### Task 6.2: ReminderService + BirthdayService — TDD

**Files:** `src/server/services/reminder.ts`, `src/server/services/birthday.ts`, `*.test.ts`.

- [ ] **Step 1: ReminderService tests**

```ts
// src/server/services/reminder.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testDb, closeTestDb } from './_db';
import { ReminderService } from './reminder';
import { EventService } from './event';
import { ContactService } from './contact';
beforeAll(() => { testDb(); }); afterAll(async () => { await closeTestDb(); });
describe('ReminderService.scheduleOffsets', () => {
  it('returns parsed offsets', () => { expect(ReminderService.scheduleOffsets('2026-07-01T10:00:00Z', [60, 1440])).toHaveLength(2); });
  it('skips past offsets', () => { const r = ReminderService.scheduleOffsets('2020-01-01T00:00:00Z', [60, 1440], new Date('2020-01-01T00:00:00Z')); expect(r).toHaveLength(0); });
});
describe('ReminderService.dueReminders', () => {
  it('returns rows with triggerAt <= now and not dispatched', async () => { const e = await EventService.create({ title: 'X', startAt: new Date('2020-01-01'), attendeeIds: [] }); const rows = await ReminderService.dueReminders(new Date('2099-01-01')); expect(rows.some(r => r.eventId === e.id)).toBe(true); });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/services/reminder.ts
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
const offsetSchema = z.array(z.number().int().min(0).max(60 * 24 * 30));
export const ReminderService = {
  /** Pure: given event start and offsets, return future trigger timestamps. */
  scheduleOffsets(startISO: string, offsetsMinutes: number[], now: Date = new Date()) {
    const start = new Date(startISO);
    return offsetsMinutes
      .map(m => new Date(start.getTime() - m * 60_000))
      .filter(t => t > now)
      .map(t => ({ triggerAt: t }));
  },
  async createManyForEvent(eventId: string, startAt: Date, offsets: number[] = [60, 1440]) {
    const rows = this.scheduleOffsets(startAt.toISOString(), offsets);
    if (!rows.length) return [];
    await prisma.reminder.createMany({ data: rows.map(r => ({ eventId, triggerAt: r.triggerAt, offsets: JSON.stringify(offsets) })) });
    return rows;
  },
  async createForContact(contactId: string, triggerAt: Date, kind: 'birthday' | 'stale' = 'birthday', offsets: number[] = [60, 1440]) {
    return prisma.reminder.create({ data: { contactId, triggerAt, kind, offsets: JSON.stringify(offsets) } });
  },
  async dueReminders(now: Date = new Date()) {
    return prisma.reminder.findMany({ where: { triggerAt: { lte: now }, dispatched: false, dismissed: false }, include: { contact: true, event: true } });
  },
  async markDispatched(id: string) { await prisma.reminder.update({ where: { id }, data: { dispatched: true } }); },
  async dismiss(id: string) { await prisma.reminder.update({ where: { id }, data: { dismissed: true } }); },
  async list(limit = 50) { return prisma.reminder.findMany({ orderBy: { triggerAt: 'asc' }, take: limit, include: { contact: true, event: true } }); },
};
```

- [ ] **Step 3: BirthdayService tests**

```ts
// src/server/services/birthday.test.ts
import { describe, it, expect } from 'vitest';
import { BirthdayService } from './birthday';
describe('BirthdayService.upcoming', () => {
  it('finds same-day and next-day birthdays within window', () => {
    const contacts = [
      { id: '1', name: '今天', birthdayMonth: 6, birthdayDay: 14 },
      { id: '2', name: '明天', birthdayMonth: 6, birthdayDay: 15 },
      { id: '3', name: '下个月', birthdayMonth: 7, birthdayDay: 1 },
    ];
    const r = BirthdayService.upcoming(contacts, new Date('2026-06-14T08:00:00'), 60 * 24 * 7);
    expect(r.map(x => x.id)).toEqual(['1', '2']);
  });
});
```

- [ ] **Step 4: Implement**

```ts
// src/server/services/birthday.ts
import { prisma } from '@/lib/prisma';
type C = { id: string; name: string; birthdayMonth: number | null; birthdayDay: number | null };
export const BirthdayService = {
  /** Pure: given contacts and a now, return those whose next birthday occurs within window (ms). */
  upcoming(contacts: C[], now: Date, windowMs: number) {
    const out: { id: string; name: string; when: Date }[] = [];
    const y = now.getFullYear();
    for (const c of contacts) {
      if (!c.birthdayMonth || !c.birthdayDay) continue;
      const thisYear = new Date(y, c.birthdayMonth - 1, c.birthdayDay, 9, 0, 0);
      const next = thisYear < now ? new Date(y + 1, c.birthdayMonth - 1, c.birthdayDay, 9, 0, 0) : thisYear;
      const diff = next.getTime() - now.getTime();
      if (diff <= windowMs) out.push({ id: c.id, name: c.name, when: next });
    }
    return out.sort((a, b) => a.when.getTime() - b.when.getTime());
  },
  async ensureBirthdayReminders(now: Date = new Date()) {
    const contacts = await prisma.contact.findMany({ where: { birthdayMonth: { not: null }, birthdayDay: { not: null } }, select: { id: true, name: true, birthdayMonth: true, birthdayDay: true } });
    const upcoming = this.upcoming(contacts, now, 60 * 24 * 60 * 60 * 1000); // 60 days
    let created = 0;
    for (const b of upcoming) {
      const exists = await prisma.reminder.findFirst({ where: { contactId: b.id, kind: 'birthday', triggerAt: b.when } });
      if (!exists) { await prisma.reminder.create({ data: { contactId: b.id, triggerAt: b.when, kind: 'birthday', offsets: JSON.stringify([60, 1440]) } }); created++; }
    }
    return created;
  },
};
```

- [ ] **Step 5: Tests pass + commit**

```bash
pnpm test reminder birthday && git add -A && git commit -m "feat(reminders): ReminderService + BirthdayService with tests"
```

### Task 6.3: Wire reminders into EventService + cron

**Files:** `src/server/services/event.ts` (modify create/update), `src/server/cron.ts`, `src/app/layout.tsx` (modify to boot cron).

- [ ] **Step 1: modify EventService.create / update to spawn reminders**

In `src/server/services/event.ts`, append to the end of `create()` and `update()`:

```ts
await ReminderService.createManyForEvent(p.id, p.startAt, [60, 1440]);
```

Also, if `update()` changes `startAt`, delete future undispatched reminders for that event and respawn:

```ts
if (p.startAt) {
  await prisma.reminder.deleteMany({ where: { eventId: id, dispatched: false, dismissed: false } });
  await ReminderService.createManyForEvent(id, p.startAt, [60, 1440]);
}
```

- [ ] **Step 2: cron**

```ts
// src/server/cron.ts
import cron from 'node-cron';
import webpush from 'web-push';
import Database from 'better-sqlite3';
import { prisma } from '@/lib/prisma';
import { ReminderService } from './services/reminder';
import { BirthdayService } from './services/birthday';

let started = false;
export function startCron() {
  if (started) return; started = true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost';
  if (pub && priv) webpush.setVapidDetails(sub, pub, priv);

  // Birthday reminders — once a day at 00:05
  cron.schedule('5 0 * * *', async () => { try { await BirthdayService.ensureBirthdayReminders(); } catch (e) { console.error('birthday cron', e); } });

  // Dispatch due reminders — every minute
  cron.schedule('* * * * *', async () => {
    try {
      const due = await ReminderService.dueReminders();
      for (const r of due) {
        const title = r.event?.title ?? (r.contact ? `${r.contact.name} 生日提醒` : '提醒');
        const body = r.event ? `${r.event.startAt.toLocaleString('zh-CN')}${r.event.location ? ' · ' + r.event.location : ''}` : '今天生日';
        const link = r.event ? `/events/${r.event.id}` : r.contact ? `/contacts/${r.contact.id}` : '/';
        await prisma.inboxItem.create({ data: { kind: 'reminder_due', title, body, link } });
        if (pub && priv) {
          const db = new Database((process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(/^file:/, ''));
          try { const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscription').all() as any[]; for (const s of subs) { try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, link })); } catch (e: any) { if (e?.statusCode === 410) db.prepare('DELETE FROM push_subscription WHERE endpoint = ?').run(s.endpoint); } } } finally { db.close(); }
        }
        await ReminderService.markDispatched(r.id);
      }
    } catch (e) { console.error('reminder cron', e); }
  });
}
```

- [ ] **Step 3: boot cron in root layout**

In `src/app/layout.tsx`, add at the very top (server side):

```ts
import { startCron } from '@/server/cron';
startCron();
```

- [ ] **Step 4: Commit**

```bash
pnpm test && git add -A && git commit -m "feat(reminders): cron + dispatch + birthday generator"
```

### Task 6.4: Service worker + push subscribe

**Files:** `public/sw.js`, `src/app/api/push/subscribe/route.ts`, `src/components/push-toggle.tsx`.

- [ ] **Step 1: service worker**

```js
// public/sw.js
self.addEventListener('push', (event) => {
  let data = { title: 'PRM 提醒', body: '', link: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { link: data.link }, icon: '/icon.png' }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? '/';
  event.waitUntil(clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) { if (c.url.includes(link)) return c.focus(); }
    return clients.openWindow(link);
  }));
});
```

- [ ] **Step 2: subscribe route**

```ts
// src/app/api/push/subscribe/route.ts
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const body = await req.json();
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return new Response('invalid', { status: 400 });
  const url = (process.env.DATABASE_URL ?? 'file:./prisma/dev.db').replace(/^file:/, '');
  const db = new Database(url);
  try { db.prepare('INSERT OR REPLACE INTO push_subscription(id, endpoint, p256dh, auth, createdAt) VALUES (?,?,?,?,?)').run(randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now()); }
  finally { db.close(); }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: client toggle**

```tsx
// src/components/push-toggle.tsx
'use client';
import { useEffect, useState } from 'react';
function urlBase64ToUint8Array(b64: string) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const b = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
export function PushToggle() {
  const [state, setState] = useState<'idle' | 'on' | 'off' | 'unsupported'>('idle');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) { setState('unsupported'); return; }
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    }).catch(() => setState('unsupported'));
  }, []);
  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
    setState('on');
  }
  if (state === 'unsupported') return <p className="text-sm text-gray-500">当前浏览器不支持 Web Push</p>;
  if (state === 'on') return <p className="text-sm text-green-700">通知已开启</p>;
  return <button onClick={subscribe} className="rounded bg-accent px-3 py-1.5 text-sm text-white">开启浏览器通知</button>;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(push): service worker + /api/push/subscribe + client toggle"
```

---

## Phase 7 — Dashboard + Inbox + Settings

### Task 7.1: Inbox

**Files:** `src/server/services/inbox.ts`, `src/app/inbox/page.tsx`, `src/app/inbox/actions.ts`.

- [ ] **Step 1: service**

```ts
// src/server/services/inbox.ts
import { prisma } from '@/lib/prisma';
export const InboxService = {
  async list() { return prisma.inboxItem.findMany({ orderBy: [{ read: 'asc' }, { createdAt: 'desc' }], take: 100 }); },
  async unreadCount() { return prisma.inboxItem.count({ where: { read: false } }); },
  async markRead(id: string) { await prisma.inboxItem.update({ where: { id }, data: { read: true } }); },
  async markAllRead() { await prisma.inboxItem.updateMany({ where: { read: false }, data: { read: true } }); },
  async remove(id: string) { await prisma.inboxItem.delete({ where: { id } }); },
};
```

- [ ] **Step 2: actions**

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { InboxService } from '@/server/services/inbox';
export async function markRead(id: string) { await InboxService.markRead(id); revalidatePath('/inbox'); }
export async function markAllRead() { await InboxService.markAllRead(); revalidatePath('/inbox'); }
export async function deleteInboxItem(id: string) { await InboxService.remove(id); revalidatePath('/inbox'); }
```

- [ ] **Step 3: page**

```tsx
// src/app/inbox/page.tsx
import Link from 'next/link';
import { InboxService } from '@/server/services/inbox';
import { markRead, markAllRead, deleteInboxItem } from './actions';
export default async function InboxPage() {
  const items = await InboxService.list();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">收件箱</h1><form action={markAllRead}><button className="rounded border px-3 py-1 text-sm">全部已读</button></form></div>
      <ul className="mt-4 divide-y">{items.length === 0 ? <li className="text-sm text-gray-500 py-6 text-center">没有消息</li> : items.map(i => <li key={i.id} className={`flex items-start gap-3 py-3 ${i.read ? 'opacity-60' : ''}`}><div className="flex-1"><div className="font-medium">{i.title}</div><div className="text-sm text-gray-600">{i.body}</div><div className="text-xs text-gray-400">{i.createdAt.toLocaleString('zh-CN')} {i.link && <Link className="text-accent ml-2" href={i.link}>查看 →</Link>}</div></div><form action={markRead.bind(null, i.id)}><button className="rounded border px-2 text-xs">已读</button></form><form action={deleteInboxItem.bind(null, i.id)}><button className="rounded border border-red-300 px-2 text-xs text-red-600">删</button></form></li>)}</ul>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(inbox): list + mark read + delete"
```

### Task 7.2: Dashboard

**Files:** `src/app/page.tsx` (rewrite), `src/server/services/dashboard.ts`.

- [ ] **Step 1: service**

```ts
// src/server/services/dashboard.ts
import { prisma } from '@/lib/prisma';
import { BirthdayService } from './birthday';
import { InboxService } from './inbox';
export const DashboardService = {
  async snapshot() {
    const [contacts, needs, upcomingEvents, unread] = await Promise.all([
      prisma.contact.count(),
      prisma.need.count({ where: { status: { in: ['open', 'matched', 'in_progress'] } } }),
      prisma.event.findMany({ where: { startAt: { gte: new Date() } }, orderBy: { startAt: 'asc' }, take: 5, include: { attendees: { include: { contact: true } } } }),
      InboxService.unreadCount(),
    ]);
    const bdayContacts = await prisma.contact.findMany({ where: { birthdayMonth: { not: null }, birthdayDay: { not: null } }, select: { id: true, name: true, birthdayMonth: true, birthdayDay: true } });
    const birthdays = BirthdayService.upcoming(bdayContacts, new Date(), 60 * 24 * 60 * 60 * 1000).slice(0, 5);
    return { contacts, needs, upcomingEvents, unread, birthdays };
  },
};
```

- [ ] **Step 2: rewrite `src/app/page.tsx`**

```tsx
import Link from 'next/link';
import { DashboardService } from '@/server/services/dashboard';
import { PushToggle } from '@/components/push-toggle';
export default async function Home() {
  const s = await DashboardService.snapshot();
  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between"><h1 className="text-3xl font-bold">PRM · 人脉管理</h1><PushToggle /></header>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Stat label="联系人" value={s.contacts} href="/contacts" />
        <Stat label="进行中需求" value={s.needs} href="/needs" />
        <Stat label="未读消息" value={s.unread} href="/inbox" />
        <Stat label="近期生日" value={s.birthdays.length} href="/contacts" />
      </div>
      <section><h2 className="font-semibold">即将到来的事件</h2>{s.upcomingEvents.length === 0 ? <p className="text-sm text-gray-500">无</p> : <ul className="mt-2 space-y-1 text-sm">{s.upcomingEvents.map(e => <li key={e.id}><Link className="text-accent" href={`/events/${e.id}`}>{e.startAt.toLocaleString('zh-CN')} · {e.title}</Link></li>)}</ul>}</section>
      <section><h2 className="font-semibold">近期生日</h2>{s.birthdays.length === 0 ? <p className="text-sm text-gray-500">无</p> : <ul className="mt-2 space-y-1 text-sm">{s.birthdays.map(b => <li key={b.id}><Link className="text-accent" href={`/contacts/${b.id}`}>{b.name} · {b.when.toLocaleDateString('zh-CN')}</Link></li>)}</ul>}</section>
    </main>
  );
}
function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return <Link href={href} className="rounded border p-3 hover:bg-gray-50"><div className="text-2xl font-semibold">{value}</div><div className="text-gray-500">{label}</div></Link>;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(dashboard): home with stats + upcoming events + birthdays"
```

### Task 7.3: Settings

**Files:** `src/app/settings/page.tsx`, `src/app/settings/actions.ts`.

- [ ] **Step 1: actions** — read/write JSON in `prisma/settings.json`.

```ts
'use server';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';
const PATH = join(process.cwd(), 'prisma', 'settings.json');
type Settings = { reminderOffsets: number[]; staleDays: number[]; accent: string };
const DEFAULTS: Settings = { reminderOffsets: [60, 1440], staleDays: [90, 180, 365], accent: '#2563eb' };
export async function readSettings(): Promise<Settings> { try { return existsSync(PATH) ? { ...DEFAULTS, ...JSON.parse(readFileSync(PATH, 'utf8')) } : DEFAULTS; } catch { return DEFAULTS; } }
export async function writeSettings(fd: FormData) {
  const next: Settings = { reminderOffsets: fd.getAll('reminderOffsets').map(Number), staleDays: fd.getAll('staleDays').map(Number), accent: String(fd.get('accent')) };
  writeFileSync(PATH, JSON.stringify(next, null, 2));
  revalidatePath('/settings');
}
```

- [ ] **Step 2: page**

```tsx
// src/app/settings/page.tsx
import { readSettings, writeSettings } from './actions';
import { PushToggle } from '@/components/push-toggle';
export default async function SettingsPage() {
  const s = await readSettings();
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">设置</h1>
      <form action={writeSettings} className="space-y-3 rounded border p-4 text-sm">
        <div><label className="block">提醒提前（分钟，逗号分隔）</label><input name="reminderOffsets" defaultValue={s.reminderOffsets.join(',')} className="mt-1 w-full rounded border p-2" /></div>
        <div><label className="block">久未联系阈值（天，逗号分隔）</label><input name="staleDays" defaultValue={s.staleDays.join(',')} className="mt-1 w-full rounded border p-2" /></div>
        <div><label className="block">主色</label><input name="accent" type="color" defaultValue={s.accent} /></div>
        <button className="rounded bg-accent px-3 py-1.5 text-white">保存</button>
      </form>
      <section className="rounded border p-4"><h2 className="font-semibold">浏览器通知</h2><PushToggle /></section>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(settings): reminder offsets + stale thresholds + push toggle"
```

---

## Phase 8 — Polish + E2E

### Task 8.1: Seed data

**Files:** `prisma/seed.ts`.

- [ ] **Step 1: implement**

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  await p.contactTag.deleteMany(); await p.interaction.deleteMany(); await p.eventAttendee.deleteMany(); await p.event.deleteMany(); await p.reminder.deleteMany(); await p.need.deleteMany(); await p.tag.deleteMany(); await p.contact.deleteMany();
  const friends = await p.tag.create({ data: { name: '朋友', color: '#10b981' } });
  const work = await p.tag.create({ data: { name: '同事', color: '#3b82f6' } });
  const inv = await p.tag.create({ data: { name: '投资人', color: '#f59e0b' } });
  const zhang = await p.contact.create({ data: { name: '张三', company: 'Acme', city: '北京', birthdayMonth: 6, birthdayDay: 14, tags: { create: [{ tagId: friends.id }] } } });
  const li = await p.contact.create({ data: { name: '李四', company: 'Globex', city: '上海', birthdayMonth: 7, birthdayDay: 1, tags: { create: [{ tagId: work.id }] } } });
  const wang = await p.contact.create({ data: { name: '王五', company: '创业公司', city: '北京', tags: { create: [{ tagId: inv.id }] } } });
  const e = await p.event.create({ data: { title: '咖啡约见', startAt: new Date(Date.now() + 3 * 86400_000), location: '三里屯', attendees: { create: [{ contactId: zhang.id }] } } });
  await p.need.create({ data: { title: '找前端工程师', category: '合作', description: '需要 3 年以上 React 经验', priority: 5 } });
  await p.need.create({ data: { title: '介绍投资人', category: '介绍', description: '种子轮', contactId: wang.id, status: 'matched' } });
  await p.interaction.create({ data: { contactId: zhang.id, occurredAt: new Date(Date.now() - 7 * 86400_000), channel: '微信', summary: '聊了产品方向' } });
  console.log('seeded:', { zhang: zhang.id, li: li.id, wang: wang.id, e: e.id });
}
main().finally(() => p.$disconnect());
```

- [ ] **Step 2: run + commit**

```bash
pnpm db:reset && pnpm exec tsx prisma/sql/apply.ts && pnpm db:seed
git add -A && git commit -m "chore(seed): demo contacts/events/needs/interactions"
```

### Task 8.2: E2E tests

**Files:** `e2e/contact-crud.spec.ts`, `e2e/event-reminder.spec.ts`, `e2e/need-kanban.spec.ts`, `e2e/search.spec.ts`.

- [ ] **Step 1: contact CRUD**

```ts
import { test, expect } from '@playwright/test';
test('contact CRUD', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('link', { name: '新建' }).click();
  await page.getByLabel('姓名 *').fill('测试联系人');
  await page.getByLabel('城市').fill('北京');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('heading', { name: '测试联系人' })).toBeVisible();
  await page.goto('/contacts?q=测试');
  await expect(page.getByText('测试联系人')).toBeVisible();
});
```

- [ ] **Step 2: event + reminder**

```ts
import { test, expect } from '@playwright/test';
test('event appears in calendar', async ({ page }) => {
  await page.goto('/events/new');
  await page.getByLabel('标题 *').fill('E2E 事件');
  await page.getByLabel('开始 *').fill(new Date(Date.now() + 86400_000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 事件' })).toBeVisible();
});
```

- [ ] **Step 3: need kanban**

```ts
import { test, expect } from '@playwright/test';
test('needs page renders', async ({ page }) => { await page.goto('/needs'); await expect(page.getByRole('heading', { name: /需求看板/ })).toBeVisible(); });
```

- [ ] **Step 4: search**

```ts
import { test, expect } from '@playwright/test';
test('search returns matches', async ({ page }) => {
  await page.goto('/search?q=北京');
  await expect(page.getByText('张三')).toBeVisible();
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test:e2e
git add -A && git commit -m "test(e2e): contact/event/need/search happy paths"
```

### Task 8.3: Production-readiness pass

**Files:** modify `next.config.mjs`, add `public/icon.png` placeholder, add error boundary.

- [ ] **Step 1: error boundary** in `src/app/error.tsx`

```tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (<main className="mx-auto max-w-md p-8 text-center"><h1 className="text-2xl font-semibold">出错了</h1><p className="mt-2 text-sm text-gray-600">{error.message}</p><button onClick={reset} className="mt-4 rounded bg-accent px-3 py-1.5 text-white">重试</button></main>);
}
```

- [ ] **Step 2: README** with backup instructions: `cp prisma/dev.db backup-$(date +%F).db`; restore is `cp backup.db prisma/dev.db`; rerun `pnpm exec tsx prisma/sql/apply.ts` if FTS triggers dropped.

- [ ] **Step 3: Final commit**

```bash
git add -A && git commit -m "chore(polish): error boundary, backup docs, icon placeholder"
```

---

## Acceptance Criteria Mapping (from spec §11)

| Spec AC | Plan Task |
|---|---|
| pnpm install + dev works | 0.1 |
| contact CRUD + tags + filter | 1.3–1.5 |
| event + reminder + push | 2.2, 6.1–6.4 |
| interaction + timeline | 3.2–3.3 |
| need + kanban | 4.2–4.3 |
| NL search 5 queries | 5.2–5.4 |
| SQLite backup portable | 8.3 (README) |
| no external services | 0.1 (single Node) |

## Done = pnpm test && pnpm test:e2e && pnpm build all pass
