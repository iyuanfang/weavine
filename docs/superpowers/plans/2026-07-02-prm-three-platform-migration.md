# PRM Three-Platform Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate PRM from Next.js SSR + Prisma to a React SPA + Rust rusqlite architecture that runs on Desktop (Tauri), Mobile (Tauri iOS/Android), and Web (Axum + static SPA).

**Architecture:**
- **Frontend**: One Vite + React + React Router SPA, shared by all three platforms
- **Backend**: One Rust core with `db::*` business logic, exposed two ways:
  - Tauri commands (desktop + mobile, invoke from JS)
  - Axum HTTP routes (web, fetch from JS)
- **DB**: rusqlite everywhere. Local SQLite on desktop/mobile, central SQLite on web server.
- **Auth**: Local PIN/biometric on desktop/mobile, JWT on web.

**Tech Stack:** Rust (rusqlite + tauri 2 + axum), TypeScript (Vite + React 18 + React Router 6 + TanStack Query), `@tauri-apps/api`, original `bcryptjs`/`jose` for web JWT.

---

## Strategic Insight (Before Starting)

**The Rust backend is already 80% built.** Files exist in `src-tauri/src/commands/`:
- `db.rs` — Database struct (rusqlite, WAL, FK on)
- `models.rs` — DTOs (Contact, Event, Action, Interaction, Reminder, Tag, Setting)
- `commands/*.rs` — `list_contacts`, `create_contact`, `update_contact`, `delete_contact`, `get_contact`, etc., for contact/event/action/interaction/reminder/tag/setting/search/diagnostic
- `lib.rs` — registers all commands

The frontend **never calls them**; it uses Next.js server actions + Prisma. Migration is mostly **frontend refactor**, not backend.

---

## File Structure

After migration, the repo will look like:

```
prm/
├── apps/
│   ├── web-spa/                   # NEW — Vite + React SPA (single frontend)
│   │   ├── src/
│   │   │   ├── routes/            # React Router pages
│   │   │   ├── components/        # ported from src/components/
│   │   │   ├── lib/
│   │   │   │   ├── adapter/       # NEW — TauriAdapter + HttpAdapter
│   │   │   │   ├── auth/          # NEW — local PIN/JWT helpers
│   │   │   │   └── types/         # ported from prisma generated types
│   │   │   ├── main.tsx
│   │   │   └── App.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts         # split: web build vs tauri build
│   │   └── package.json
│   └── web-server/                # NEW — Axum server
│       ├── src/
│       │   ├── main.rs            # bootstrap, static file serving
│       │   ├── routes/            # mirrors commands/*.rs
│       │   └── auth.rs            # JWT helpers
│       └── Cargo.toml
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                 # UNCHANGED (registers commands)
│   │   ├── commands/              # UNCHANGED
│   │   ├── db.rs                  # UNCHANGED
│   │   ├── models.rs              # UNCHANGED
│   │   ├── spawner.rs             # DELETE (no more Next.js server)
│   │   ├── mobile.rs              # NEW — mobile-specific (notifications etc.)
│   │   └── bin/
│   │       └── web_server.rs      # NEW — binary target wrapping same business logic
│   ├── tauri.conf.json            # MODIFY (frontendDist, remove url)
│   └── Cargo.toml                 # ADD axum, tokio
├── prisma/                        # DELETE (rusqlite owns schema)
│   └── schema.prisma              # → migrate to src-tauri/migrations/
├── src/                           # DELETE (Next.js frontend)
│   ├── app/                       # → ported to apps/web-spa/src/routes/
│   ├── components/                # → ported to apps/web-spa/src/components/
│   ├── server/services/           # DELETE (replaced by Rust)
│   └── lib/prisma.ts              # DELETE
└── package.json                   # MODIFY (remove Next.js scripts)
```

Note: This structure uses `apps/` to optionally split into a Cargo workspace + npm workspaces. Single-package alternative: keep everything in root and add `apps/web-spa/`. We pick **npm workspaces** (`apps/web-spa` as workspace member) for frontend, **single Cargo project** for backend (with `bin/web_server.rs`).

---

## Phase Overview

```
Phase 0 — Verify Rust backend works end-to-end          [1 task]
Phase 1 — Build web-spa (Vite + React + adapter layer)  [6 tasks]
Phase 2 — Migrate auth flow                              [4 tasks]
Phase 3 — Migrate one page end-to-end (Today page)       [5 tasks]
Phase 4 — Migrate remaining pages (incremental)         [12 tasks]
Phase 5 — Remove Next.js + spawner.rs                   [3 tasks]
Phase 6 — Add Axum web server                           [4 tasks]
Phase 7 — Tauri Mobile (iOS + Android)                  [5 tasks]
Phase 8 — Native mobile notifications                   [3 tasks]
```

Each task is one focused unit. Commit after every task.

---

## Phase 0: Verify Rust Backend Works

### Task 0.1: Smoke-test Tauri invoke

**Files:**
- Modify: `src/app/page.tsx` (one-time test, then revert)

- [ ] **Step 1: Write a temporary smoke test page**

Modify `src/app/page.tsx` so its default export is replaced with:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export default function Home() {
  const [info, setInfo] = useState<string>('pending');
  useEffect(() => {
    invoke<string>('get_startup_info').then(setInfo).catch(e => setInfo(`ERR: ${e}`));
  }, []);
  return <pre style={{padding: 20}}>{info}</pre>;
}
```

- [ ] **Step 2: Run Tauri dev**

```bash
cd src-tauri && cargo tauri dev
```

Expected: window opens showing JSON like `{"rustVersion":"...","dbPath":"..."}`.

- [ ] **Step 3: Revert the page change**

```bash
git checkout src/app/page.tsx
```

- [ ] **Step 4: Commit (no-op)**

If step 3 produced no diff, skip this commit. Otherwise:

```bash
git commit -m "chore: verify Rust invoke works end-to-end (smoke test)"
```

This task establishes confidence that the Rust backend is callable. **If it fails, do not proceed to Phase 1 — fix Rust first.**

---

## Phase 1: Build web-spa Scaffold

### Task 1.1: Initialize npm workspace for web-spa

**Files:**
- Create: `apps/web-spa/package.json`
- Create: `apps/web-spa/tsconfig.json`
- Create: `apps/web-spa/index.html`
- Create: `apps/web-spa/vite.config.ts`
- Modify: `package.json` (root) — add `"workspaces": ["apps/*"]`

- [ ] **Step 1: Create apps/web-spa/package.json**

```json
{
  "name": "@prm/web-spa",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "vite build --mode tauri",
    "web": "vite build --mode web"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.51.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create apps/web-spa/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/web-spa/index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PRM</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create apps/web-spa/vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri injects TAURI_DEV_HOST or we use fixed values
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
```

- [ ] **Step 5: Update root package.json with workspaces**

Modify root `package.json`, add top-level:

```json
{
  "workspaces": ["apps/*"]
}
```

- [ ] **Step 6: Install**

```bash
cd /home/yf/workspace/opencode/prm && pnpm install
```

- [ ] **Step 7: Commit**

```bash
git add apps/web-spa package.json pnpm-lock.yaml
git commit -m "feat(web-spa): scaffold Vite + React + TypeScript"
```

### Task 1.2: Adapter layer — Tauri invoke wrapper

**Files:**
- Create: `apps/web-spa/src/lib/adapter/index.ts`
- Create: `apps/web-spa/src/lib/adapter/tauri.ts`
- Create: `apps/web-spa/src/lib/adapter/http.ts`
- Create: `apps/web-spa/src/lib/adapter/types.ts`
- Create: `apps/web-spa/src/lib/adapter/index.test.ts`

- [ ] **Step 1: Create types file**

`apps/web-spa/src/lib/adapter/types.ts`:

```ts
// Mirrors src-tauri/src/models.rs DTOs.
// Keep in sync with Rust.

export type Contact = {
  id: string;
  ownerId: string;
  nickname: string;
  name: string | null;
  company: string | null;
  title: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  notes: string | null;
  importance: 'important' | 'normal' | 'low';
  reminderEnabled: boolean;
  reminderIntervalDays: number | null;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
};

export type ListContactsParams = {
  ownerId: string;
  search?: string | null;
  importance?: 'important' | 'normal' | 'low' | null;
  tagId?: string | null;
  page?: number;
  pageSize?: number;
  sort?: 'recent' | 'importance' | 'name';
};

export type Event = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  location: string | null;
  contactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Action = {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'cancelled';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  contactId: string | null;
  eventId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Interaction = {
  id: string;
  ownerId: string;
  contactId: string;
  occurredAt: string;
  channel: string;
  summary: string;
  createdAt: string;
};

export type Reminder = {
  id: string;
  ownerId: string;
  contactId: string;
  remindAt: string;
  dismissed: boolean;
};

export type Tag = {
  id: string;
  ownerId: string;
  name: string;
  color: string | null;
  createdAt: string;
};

// ... add other DTOs as Rust commands are exposed.
```

- [ ] **Step 2: Create Tauri adapter**

`apps/web-spa/src/lib/adapter/tauri.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type * as T from './types';

export class TauriAdapter {
  async listContacts(p: T.ListContactsParams): Promise<T.Contact[]> {
    return invoke<T.Contact[]>('list_contacts', { params: p });
  }
  async getContact(id: string, ownerId: string): Promise<T.Contact> {
    return invoke<T.Contact>('get_contact', { id, ownerId });
  }
  async createContact(input: Omit<T.Contact, 'id' | 'createdAt' | 'updatedAt' | 'tags' | 'lastContactedAt'>) {
    return invoke<T.Contact>('create_contact', { input });
  }
  async updateContact(id: string, input: Partial<T.Contact>) {
    return invoke<T.Contact>('update_contact', { id, input });
  }
  async deleteContact(id: string): Promise<void> {
    return invoke<void>('delete_contact', { id });
  }

  async listEvents(p: { ownerId: string; from: string; to: string }): Promise<T.Event[]> {
    return invoke<T.Event[]>('list_events', { params: p });
  }
  // ... mirror every command in src-tauri/src/commands/*.rs

  async getStartupInfo(): Promise<string> {
    return invoke<string>('get_startup_info');
  }
}
```

- [ ] **Step 3: Create HTTP adapter (stub for now, fill in Phase 6)**

`apps/web-spa/src/lib/adapter/http.ts`:

```ts
import type * as T from './types';

export class HttpAdapter {
  constructor(private baseUrl: string, private getToken: () => string | null) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.getToken() && { Authorization: `Bearer ${this.getToken()}` }),
      },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    return res.json();
  }

  async listContacts(p: T.ListContactsParams): Promise<T.Contact[]> {
    return this.req('GET', `/api/contacts?${new URLSearchParams(p as Record<string, string>)}`);
  }
  // ... mirror all TauriAdapter methods
}
```

- [ ] **Step 4: Write failing test for adapter dispatch**

`apps/web-spa/src/lib/adapter/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAdapter } from './index';

describe('adapter dispatch', () => {
  it('uses TauriAdapter when running inside Tauri', () => {
    // Simulate Tauri by stubbing window.__TAURI_INTERNALS__
    (globalThis as any).window = { __TAURI_INTERNALS__: {} };
    const a = getAdapter();
    expect(a.constructor.name).toBe('TauriAdapter');
  });

  it('uses HttpAdapter when running in browser', () => {
    (globalThis as any).window = {};
    const a = getAdapter();
    expect(a.constructor.name).toBe('HttpAdapter');
  });
});
```

- [ ] **Step 5: Create the index.ts (dispatch logic)**

`apps/web-spa/src/lib/adapter/index.ts`:

```ts
import { TauriAdapter } from './tauri';
import { HttpAdapter } from './http';
import type * as T from './types';

export type Adapter = TauriAdapter | HttpAdapter;

let cached: Adapter | null = null;

export function getAdapter(): Adapter {
  if (cached) return cached;
  // __TAURI_INTERNALS__ is injected by Tauri at runtime
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    cached = new TauriAdapter();
  } else {
    const base = import.meta.env.VITE_API_BASE || '';
    cached = new HttpAdapter(base, () => localStorage.getItem('token'));
  }
  return cached;
}

export type { T };
```

- [ ] **Step 6: Run the failing test**

```bash
cd apps/web-spa && pnpm vitest run src/lib/adapter
```

Expected: PASS (both dispatch tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web-spa/src/lib/adapter
git commit -m "feat(web-spa): data adapter layer with Tauri and HTTP implementations"
```

### Task 1.3: Root mount + React Query setup

**Files:**
- Create: `apps/web-spa/src/main.tsx`
- Create: `apps/web-spa/src/App.tsx`

- [ ] **Step 1: Create main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './globals.css';  // port later from src/app/globals.css

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: Create App.tsx (skeleton router)**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>PRM — coming soon</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Run dev**

```bash
cd apps/web-spa && pnpm dev
```

Open http://localhost:1420 — expected: "PRM — coming soon".

- [ ] **Step 4: Commit**

```bash
git add apps/web-spa/src
git commit -m "feat(web-spa): bootstrap React Query + minimal router"
```

### Task 1.4: Port globals.css

**Files:**
- Create: `apps/web-spa/src/globals.css`

- [ ] **Step 1: Copy from Next.js globals.css**

```bash
cp src/app/globals.css apps/web-spa/src/globals.css
```

- [ ] **Step 2: Verify dev server still works**

Confirm Tailwind/badges/buttons render correctly (load a sample later when components are migrated).

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/globals.css
git commit -m "feat(web-spa): port globals.css"
```

### Task 1.5: Add Tailwind to web-spa

**Files:**
- Create: `apps/web-spa/tailwind.config.ts`
- Create: `apps/web-spa/postcss.config.cjs`
- Modify: `apps/web-spa/src/globals.css`

- [ ] **Step 1: Install tailwind**

```bash
cd apps/web-spa && pnpm add -D tailwindcss@3 postcss autoprefixer
```

- [ ] **Step 2: Create tailwind.config.ts**

```ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create postcss.config.cjs**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: Prepend @tailwind directives to globals.css**

Add at top of `globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Verify a button still styled**

Temporarily edit `App.tsx`: `<button className="btn-primary">Test</button>` — confirm styled.

- [ ] **Step 6: Commit**

```bash
git add apps/web-spa
git commit -m "feat(web-spa): add Tailwind"
```

### Task 1.6: Wire web-spa into Tauri

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update tauri.conf.json**

Replace the relevant fields:

```json
{
  "build": {
    "devUrl": "http://localhost:1420",
    "frontendDist": "../apps/web-spa/dist",
    "beforeBuildCommand": "pnpm --filter @prm/web-spa build",
    "beforeDevCommand": "pnpm --filter @prm/web-spa dev"
  }
}
```

- [ ] **Step 2: Remove `url` from window config (no more local server)**

In tauri.conf.json `tauri.windows[0]`, **remove** the `url` field if present.

- [ ] **Step 3: Run tauri dev**

```bash
pnpm tauri:dev
```

Expected: Vite dev server starts, Tauri window opens pointing at it, "PRM — coming soon" visible.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(tauri): use web-spa instead of Next.js dev server"
```

---

## Phase 2: Auth Flow

Critical insight: **No Next.js, no Auth.js**. Desktop/mobile gets **local user** (already works via `initializeDesktopUser` in `src/lib/auth/session.ts`). Web gets **JWT**.

### Task 2.1: Re-implement local auth for desktop

The Rust side already auto-creates `local@prm.local` when launched. We just need the frontend to recognize "I'm always logged in on desktop".

**Files:**
- Create: `apps/web-spa/src/lib/auth/local.ts`
- Modify: `apps/web-spa/src/lib/adapter/index.ts` (add `getCurrentUser`)

- [ ] **Step 1: Create local auth helper**

`apps/web-spa/src/lib/auth/local.ts`:

```ts
// On desktop, user is always the local user (auto-created on first launch).
// Mirror of src/lib/auth/session.ts:initializeDesktopUser
export const LOCAL_USER = {
  id: 'local',
  email: 'local@prm.local',
  name: 'Local User',
} as const;
```

- [ ] **Step 2: Add `currentUserId` helper to adapter**

Add to `apps/web-spa/src/lib/adapter/index.ts`:

```ts
export async function getCurrentUserId(): Promise<string> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    // Tauri side has already initialized local user; we trust it.
    // OwnerId for local user is "local" (matches Rust initialize logic).
    return 'local';
  }
  // Web: read from JWT (Phase 6 finalizes)
  const token = localStorage.getItem('token');
  if (!token) throw new Error('not authenticated');
  return JSON.parse(atob(token.split('.')[1])).sub;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/lib/auth apps/web-spa/src/lib/adapter/index.ts
git commit -m "feat(web-spa): local auth for desktop"
```

### Task 2.2: Login page (web only — desktop auto-auth)

**Files:**
- Create: `apps/web-spa/src/routes/Login.tsx`

- [ ] **Step 1: Write Login.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_BASE || '';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('登录失败，请检查邮箱和密码');
      return;
    }
    const { token } = await res.json();
    localStorage.setItem('token', token);
    navigate('/');
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold mb-4">登录</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-base w-full"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-base w-full"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="btn-primary w-full">登录</button>
      </form>
      <p className="mt-4 text-sm">
        还没有账号？<a href="/signup" className="text-blue-600">注册</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

```tsx
<Route path="/login" element={<Login />} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/routes/Login.tsx apps/web-spa/src/App.tsx
git commit -m "feat(web-spa): login page (web)"
```

### Task 2.3: Sign-up page

**Files:**
- Create: `apps/web-spa/src/routes/Signup.tsx`

- [ ] **Step 1: Write Signup.tsx**

Mirror Login.tsx with POST `/api/auth/signup`. **Do not copy Auth.js — the web server has its own signup endpoint (added in Phase 6).**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_BASE || '';

export function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`${API}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('注册失败（密码至少 8 位）');
      return;
    }
    const { token } = await res.json();
    localStorage.setItem('token', token);
    navigate('/');
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold mb-4">注册</h1>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="邮箱" value={email}
          onChange={(e) => setEmail(e.target.value)} className="input-base w-full" />
        <input type="password" required minLength={8} placeholder="密码 (≥8位)" value={password}
          onChange={(e) => setPassword(e.target.value)} className="input-base w-full" />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="btn-primary w-full">注册</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Add route**

In App.tsx add `<Route path="/signup" element={<Signup />} />`.

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/routes/Signup.tsx apps/web-spa/src/App.tsx
git commit -m "feat(web-spa): signup page"
```

### Task 2.4: Top-level auth gating

**Files:**
- Modify: `apps/web-spa/src/App.tsx`

- [ ] **Step 1: Add auth gate component**

Add before `BrowserRouter`:

```tsx
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCurrentUserId } from './lib/adapter';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [authed, setAuthed] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUserId();
        setAuthed(true);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  if (isTauri) return children;        // always authorized on desktop
  if (authed === null) return null;    // loading
  if (!authed) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}
```

- [ ] **Step 2: Wrap routes**

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/signup" element={<Signup />} />
  <Route path="/*" element={<RequireAuth><AppRoutes /></RequireAuth>} />
</Routes>
```

Where `<AppRoutes>` is the actual page tree (built out in Phase 3-4). For now keep one placeholder.

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/App.tsx
git commit -m "feat(web-spa): auth gate (web login flow)"
```

---

## Phase 3: Migrate Today Page (Reference Implementation)

Use Today page as the template for migrating remaining pages.

### Task 3.1: Port shared UI components

**Files:**
- Create: `apps/web-spa/src/components/Card.tsx` (port from `src/components/card.tsx`)
- Create: `apps/web-spa/src/components/Button.tsx`
- Create: `apps/web-spa/src/components/Avatar.tsx`

- [ ] **Step 1: Copy Card component**

```bash
cp src/components/card.tsx apps/web-spa/src/components/Card.tsx
```

Fix import paths if needed (remove `@/` aliases — use relative paths or set tsconfig paths).

- [ ] **Step 2: Copy Avatar component**

```bash
cp src/components/avatar.tsx apps/web-spa/src/components/Avatar.tsx
```

- [ ] **Step 3: Set up tsconfig path aliases**

Add to `apps/web-spa/tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

And in `vite.config.ts` add:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // ... rest of config
});
```

- [ ] **Step 4: Verify build**

```bash
cd apps/web-spa && pnpm build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/components apps/web-spa/tsconfig.json apps/web-spa/vite.config.ts
git commit -m "feat(web-spa): port Card + Avatar components + aliases"
```

### Task 3.2: Today page route + data hooks

**Files:**
- Create: `apps/web-spa/src/routes/Today.tsx`
- Create: `apps/web-spa/src/lib/hooks/useToday.ts`

- [ ] **Step 1: Create Today hook**

`apps/web-spa/src/lib/hooks/useToday.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../adapter';
import { getCurrentUserId } from '../adapter';

export function useToday() {
  return useQuery({
    queryKey: ['today'],
    queryFn: async () => {
      const adapter = getAdapter();
      const ownerId = await getCurrentUserId();
      const [timeline, actions, reminders] = await Promise.all([
        adapter.listTimeline({ ownerId, day: new Date().toISOString().slice(0, 10) }),
        adapter.listActions({ ownerId, status: 'open' }),
        adapter.listReminders({ ownerId, dismissed: false }),
      ]);
      return { timeline, actions, reminders };
    },
  });
}
```

(If Rust has `list_timeline` command — check `src-tauri/src/commands/`. If not, derive from event + action + interaction queries.)

- [ ] **Step 2: Create empty Today page**

`apps/web-spa/src/routes/Today.tsx`:

```tsx
import { useToday } from '@/lib/hooks/useToday';

export function Today() {
  const { data, isLoading } = useToday();
  if (isLoading || !data) return <div className="p-6">加载中…</div>;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-4">今天</h1>
      <p className="text-sm text-gray-500">
        {data.timeline.length} 条互动 · {data.actions.length} 个待办 · {data.reminders.length} 个提醒
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Wire route in App.tsx**

```tsx
<Route path="/today" element={<Today />} />
```

- [ ] **Step 4: Run `tauri:dev` and verify page loads in Tauri window**

This is the **first end-to-end test**. Expected: Tauri window shows "Today" with stats.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/routes/Today.tsx apps/web-spa/src/lib/hooks
git commit -m "feat(web-spa): Today page (first end-to-end SPA → Tauri invoke)"
```

### Task 3.3: Today sub-components (timeline, action list, reminders)

**Files:**
- Create: `apps/web-spa/src/components/today/Timeline.tsx`
- Create: `apps/web-spa/src/components/today/ActionList.tsx`
- Create: `apps/web-spa/src/components/today/ReminderList.tsx`

- [ ] **Step 1: Port Timeline.tsx**

Source: `src/components/today/timeline.tsx` (or wherever it lives). Bring over the JSX, swap any server-side imports for adapter calls.

- [ ] **Step 2: Port ActionList.tsx**

Same pattern.

- [ ] **Step 3: Port ReminderList.tsx**

Same pattern.

- [ ] **Step 4: Wire them into Today.tsx**

```tsx
<Timeline items={data.timeline} />
<ActionList items={data.actions} />
<ReminderList items={data.reminders} />
```

- [ ] **Step 5: Verify in Tauri dev**

- [ ] **Step 6: Commit**

```bash
git add apps/web-spa/src/components/today apps/web-spa/src/routes/Today.tsx
git commit -m "feat(web-spa): Today page sub-components"
```

### Task 3.4: QuickLogBar (top-of-today input)

**Files:**
- Create: `apps/web-spa/src/components/QuickLogBar.tsx`

- [ ] **Step 1: Port from src/components/quick-log-bar.tsx**

Convert any server actions to `getAdapter().createInteraction({...})`. If createInteraction expects `ownerId`, fetch from `getCurrentUserId()`.

- [ ] **Step 2: Wire into Today.tsx**

- [ ] **Step 3: Verify**

- [ ] **Step 4: Commit**

```bash
git add apps/web-spa/src/components/QuickLogBar.tsx
git commit -m "feat(web-spa): QuickLogBar"
```

---

## Phase 4: Migrate Remaining Pages

Pattern from Phase 3 repeats. Each page becomes a route + a few components.

### Task 4.1: Contacts list page

- [ ] Port `src/app/contacts/page.tsx` → `apps/web-spa/src/routes/Contacts.tsx`
- [ ] Port `ContactCard` component
- [ ] Wire route
- [ ] Verify

### Task 4.2: Contact detail page

- [ ] Port `src/app/contacts/[id]/page.tsx` → uses `useParams()` for `[id]`
- [ ] Port `InteractionForm` (was converted to flex already — see commit history)
- [ ] Wire mutations via adapter

### Task 4.3: Contact create/edit

- [ ] Port `/contacts/new`, `/contacts/[id]/edit`
- [ ] Replace server actions with adapter calls

### Task 4.4: Tags page

- [ ] Port `/tags`

### Task 4.5: Calendar page (FullCalendar)

- [ ] Install `@fullcalendar/*` packages — versions already in package.json
- [ ] Port Calendar component
- [ ] Wire data via hook

### Task 4.6: Events pages

- [ ] Port `/events`, `/events/[id]`, `/events/new`

### Task 4.7: Actions (待办) pages

- [ ] Port `/actions`, `/actions/[id]`
- [ ] Kanban view

### Task 4.8: Reminders page

- [ ] Port `/reminders`

### Task 4.9: Settings page

- [ ] Port `/settings`

### Task 4.10: Search page

- [ ] Port `/search`
- [ ] Wire to `search` Tauri command

### Task 4.11: QuickLog combined page

- [ ] Port `/quick-log`

### Task 4.12: Layout shell (header, nav)

- [ ] Create `Layout` component with header + nav links
- [ ] Wrap all routes (except login/signup)

(Detailed commits per page omitted for brevity — follow the same one-commit-per-page pattern as Task 4.1.)

---

## Phase 5: Remove Next.js + spawner.rs

### Task 5.1: Update package.json scripts

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Replace dev/build/start with web-spa equivalents**

```json
{
  "scripts": {
    "dev": "pnpm --filter @prm/web-spa dev",
    "build": "pnpm --filter @prm/web-spa build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "pnpm --filter @prm/web-spa tauri && tauri build"
  }
}
```

- [ ] **Step 2: Remove unused deps**

Remove: `next`, `react` (root, since web-spa owns it now), `react-dom`, `@auth/*`, `next-auth`, `bcryptjs`, `prisma`, `@prisma/client`.

- [ ] **Step 3: Verify `pnpm tauri:dev` still works**

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: replace Next.js scripts with web-spa"
```

### Task 5.2: Delete Next.js files + spawner

**Files:**
- Delete: `src/` (entire directory)
- Delete: `prisma/` (entire directory)
- Delete: `src-tauri/src/spawner.rs`
- Delete: `dev.db`, `prisma/dev.db`

- [ ] **Step 1: Remove src tree**

```bash
git rm -r src/
```

- [ ] **Step 2: Remove prisma tree**

```bash
git rm -r prisma/
```

- [ ] **Step 3: Remove dev.db and standalone build artifacts**

```bash
git rm -f dev.db prisma/dev.db
rm -rf .next standalone-bundle tauri-dist
```

(Add `.next`, `standalone-bundle`, `tauri-dist`, `dev.db` to `.gitignore`.)

- [ ] **Step 4: Remove spawner.rs from src-tauri**

```bash
git rm src-tauri/src/spawner.rs
```

Also: in `src-tauri/src/lib.rs`, remove the `mod spawner;` line and any call to `spawner::*` functions.

- [ ] **Step 5: Build Tauri to verify no compilation errors**

```bash
pnpm tauri:build
```

Expected: builds. App launches. All pages work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat!: remove Next.js and Rust spawner (single static SPA in Tauri)"
```

This is a **breaking change** if anyone consumes Next.js app externally.

### Task 5.3: Move DB schema to Rust migrations

**Files:**
- Create: `src-tauri/migrations/001_init.sql`
- Modify: `src-tauri/src/db.rs` (add migrate-on-boot logic)
- Create: `src-tauri/src/schema.rs` (CREATE TABLE statements)

- [ ] **Step 1: Convert prisma/schema.prisma to SQL**

Map each Prisma model → CREATE TABLE statement. Use `database/sql`-style naming (we named fields camelCase in SQLite).

- [ ] **Step 2: Add migration runner to db.rs**

```rust
// On Database::open:
for migration in MIGRATIONS {
    conn.execute_batch(migration)?;
}
```

- [ ] **Step 3: Test fresh-install scenario**

Delete `~/.local/share/com.weavine.prm/dev.db`, run `tauri:dev`, verify schema bootstraps and app works.

- [ ] **Step 4: Test upgrade path**

If migrating users from old DBs: include ALTER TABLE statements; bump migration version.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/migrations src-tauri/src/db.rs
git commit -m "feat(tauri): embed SQL migrations, drop Prisma"
```

---

## Phase 6: Web via Axum

Now we expose the same Rust business logic via HTTP for the web.

### Task 6.1: Add Axum + JWT to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add deps**

```toml
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower = "0.5"
tower-http = { version = "0.5", features = ["cors", "fs"] }
jsonwebtoken = "9"
serde = { version = "1", features = ["derive"] }
```

- [ ] **Step 2: Verify cargo build**

```bash
cd src-tauri && cargo check
```

Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat(tauri): add Axum + JWT deps for web server"
```

### Task 6.2: Extract `db::*` into pure-business-logic crate

**Files:**
- Create: `src-tauri/src/business/` (new module)
- Move: `db::contact::list()` etc. into `business::contact`

- [ ] **Step 1: Refactor db.rs to expose pure modules**

Split `db.rs` into per-domain modules (`business/contact.rs`, `business/event.rs`, etc.) that take `&Connection` as an argument. They become **plain functions**, callable from both Tauri commands and Axum handlers.

- [ ] **Step 2: Update existing commands to use new structure**

Tauri commands become thin wrappers:
```rust
#[tauri::command]
fn list_contacts(db: State<Database>, p: ListContactsParams) -> Result<Vec<Contact>, String> {
    let conn = db.conn.lock().unwrap();
    business::contact::list(&conn, &p).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Add tests for business layer (without Tauri)**

```rust
#[cfg(test)]
mod tests {
    fn temp_db() -> Connection { ... }
    #[test]
    fn list_contacts_filters_by_owner() {
        let conn = temp_db();
        let result = business::contact::list(&conn, &ListContactsParams { owner_id: "u1".into(), ... }).unwrap();
        assert_eq!(result.len(), 0);
    }
}
```

- [ ] **Step 4: Run all tests, all pass**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/business src-tauri/src/db.rs src-tauri/src/commands
git commit -m "refactor(tauri): extract business:: modules from commands"
```

### Task 6.3: Add binary target for Axum

**Files:**
- Create: `src-tauri/src/bin/web_server.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add binary target**

In Cargo.toml:

```toml
[[bin]]
name = "weavine-web"
path = "src/bin/web_server.rs"
```

- [ ] **Step 2: Implement web_server.rs**

```rust
use axum::{Router, routing::{get, post, put, delete}, extract::{State, Json, Path, Query}};
use std::sync::{Arc, Mutex};
use crate::db::Database;
use crate::business;

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<rusqlite::Connection>>,
    jwt_secret: Arc<String>,
}

#[tokio::main]
async fn main() {
    let db_path = std::env::var("DB_PATH").unwrap_or_else(|_| "weavine.db".into());
    let conn = rusqlite::Connection::open(&db_path).expect("open db");
    crate::db::run_migrations(&conn).expect("migrations");
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        jwt_secret: Arc::new(std::env::var("JWT_SECRET").expect("JWT_SECRET")),
    };

    let app = Router::new()
        .route("/api/contacts",       get(handlers::contacts::list).post(handlers::contacts::create))
        .route("/api/contacts/:id",    get(handlers::contacts::get).put(handlers::contacts::update).delete(handlers::contacts::delete))
        // ... mirror all commands
        .route("/api/auth/login",     post(handlers::auth::login))
        .route("/api/auth/signup",    post(handlers::auth::signup))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

- [ ] **Step 3: Implement per-domain handlers**

`src-tauri/src/bin/handlers/contact.rs`:

```rust
use axum::{extract::{State, Path, Query, Json}, http::StatusCode};
use crate::AppState;
use crate::business;

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<crate::ListContactsParams>,
) -> Result<Json<Vec<crate::Contact>>, String> {
    let conn = s.db.lock().unwrap();
    let user_id = crate::auth::verify_jwt(&s, /* from headers */)?;
    let mut p = p;
    p.owner_id = user_id;
    business::contact::list(&conn, &p).map(Json).map_err(|e| e.to_string())
}

// ... create, update, delete, get
```

Use `axum-extra::TypedHeader` to extract `Authorization` header.

- [ ] **Step 4: Add auth handlers with bcrypt + JWT**

`src-tauri/src/bin/handlers/auth.rs`:

```rust
use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use bcrypt::verify;
use jsonwebtoken::{encode, Header, EncodingKey};

#[derive(Deserialize)]
struct LoginReq { email: String, password: String }

#[derive(Serialize)]
struct LoginResp { token: String }

pub async fn login(
    State(s): State<AppState>,
    Json(req): Json<LoginReq>,
) -> Result<Json<LoginResp>, String> {
    let conn = s.db.lock().unwrap();
    let row: (String, String) = conn.query_row(
        "SELECT id, passwordHash FROM User WHERE email = ?1",
        [&req.email],
        |r| Ok((r.get(0)?, r.get(1)?))
    ).map_err(|_| "no such user".to_string())?;

    if !verify(&req.password, &row.1).map_err(|e| e.to_string())? {
        return Err("wrong password".into());
    }

    let token = encode(
        &Header::default(),
        &serde_json::json!({"sub": row.0, "exp": chrono::Utc::now().timestamp() + 86400}),
        &EncodingKey::from_secret(s.jwt_secret.as_bytes()),
    ).map_err(|e| e.to_string())?;

    Ok(Json(LoginResp { token }))
}

pub async fn signup(...) { /* generate bcrypt hash, insert User, return JWT */ }
```

- [ ] **Step 5: Add bcrypt crate**

```toml
bcrypt = "0.15"
```

- [ ] **Step 6: Run `cargo build --bin weavine-web`**

Expected: builds.

- [ ] **Step 7: Smoke-test with curl**

```bash
DB_PATH=/tmp/test.db JWT_SECRET=test ./target/release/weavine-web &
curl -X POST http://localhost:3000/api/auth/signup -d '{"email":"a@b.c","password":"12345678"}' -H 'Content-Type: application/json'
curl http://localhost:3000/api/contacts -H "Authorization: Bearer $TOKEN"
```

Expected: signup returns token; list returns `[]`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri
git commit -m "feat(web): Axum server wrapping same business logic"
```

### Task 6.4: Serve built SPA as static files

**Files:**
- Modify: `src-tauri/src/bin/web_server.rs`

- [ ] **Step 1: Add tower-http::ServeDir**

```rust
use tower_http::services::ServeDir;

let app = Router::new()
    .nest("/api", api_routes())
    .fallback_service(ServeDir::new("../apps/web-spa/dist").append_index_html_on_directories(true))
    .with_state(state);
```

- [ ] **Step 2: Build SPA + server together**

```bash
pnpm --filter @prm/web-spa build
cd src-tauri && cargo build --release --bin weavine-web
```

- [ ] **Step 3: Run, open http://localhost:3000**

Expected: Login page renders. After login, see Today page with data.

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat(web): serve built SPA from Axum"
```

---

## Phase 7: Tauri Mobile (iOS + Android)

### Task 7.1: Initialize Tauri mobile

**Files:**
- Create: `src-tauri/gen/schemas/*` (auto-generated)
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/ios/` (auto-generated)
- Create: `src-tauri/android/` (auto-generated)

- [ ] **Step 1: Run tauri init for mobile**

```bash
cd src-tauri && cargo tauri init --mobile
```

This scaffolds iOS + Android folders.

- [ ] **Step 2: Update tauri.conf.json with mobile app identifier**

Set `identifier` and add mobile settings.

- [ ] **Step 3: Add necessary mobile plugin configuration**

In `src-tauri/capabilities/`, ensure plugins are tagged correctly for mobile.

- [ ] **Step 4: Try `cargo tauri ios init`**

Expected: scaffolds iOS project.

- [ ] **Step 5: Commit (auto-generated files only at this stage)**

```bash
git add src-tauri
git commit -m "feat(mobile): initialize Tauri iOS/Android scaffolding"
```

### Task 7.2: Build for Android

**Files:** (auto-generated mostly)

- [ ] **Step 1: Run cargo tauri android build**

```bash
cd src-tauri && cargo tauri android build
```

Expected: APK generated.

- [ ] **Step 2: Smoke-test on emulator**

```bash
cd src-tauri && cargo tauri android dev
```

Expected: SPA loads, navigation works, rust commands respond.

- [ ] **Step 3: Commit any config changes**

```bash
git add src-tauri/android src-tauri/tauri.conf.json
git commit -m "feat(mobile): Android build working"
```

### Task 7.3: Build for iOS (macOS host required)

- [ ] **Step 1: Run cargo tauri ios build**

- [ ] **Step 2: Verify IPA generates**

### Task 7.4: Mobile-specific layout polish

**Files:**
- Create: `apps/web-spa/src/components/mobile/MobileNav.tsx`
- Modify: `apps/web-spa/src/App.tsx`

- [ ] **Step 1: Detect mobile platform**

Use `window.innerWidth` or `navigator.userAgent` (Tauri also exposes platform via `__TAURI_INTERNALS__`).

- [ ] **Step 2: Render bottom nav on mobile**

Replace top nav with bottom tab bar for mobile.

- [ ] **Step 3: Test on Android emulator**

- [ ] **Step 4: Commit**

```bash
git add apps/web-spa/src/components/mobile apps/web-spa/src/App.tsx
git commit -m "feat(mobile): bottom tab navigation"
```

### Task 7.5: Database path on mobile

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Use platform-specific paths**

```rust
fn data_dir() -> PathBuf {
    #[cfg(target_os = "android")]
    { dirs::data_dir().unwrap().join("com.weavine.prm") }
    #[cfg(target_os = "ios")]
    { dirs::document_dir().unwrap() }  // iOS sandboxed
    #[cfg(target_os = "macos")]
    { dirs::data_dir().unwrap().join("com.weavine.prm") }
    #[cfg(target_os = "linux")]
    { dirs::data_dir().unwrap().join("com.weavine.prm") }
    #[cfg(target_os = "windows")]
    { dirs::data_dir().unwrap().join("com.weavine.prm") }
}
```

- [ ] **Step 2: Test on Android — verify DB writes persist across app restart**

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "fix(mobile): use platform-appropriate data directory"
```

---

## Phase 8: Mobile Native Notifications

### Task 8.1: Add tauri-plugin-notification

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` (auto)
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add plugin**

```toml
[dependencies]
tauri-plugin-notification = "2"
```

- [ ] **Step 2: Register plugin in lib.rs**

```rust
.plugin(tauri_plugin_notification::init())
```

- [ ] **Step 3: Add permission in capabilities/default.json**

```json
{
  "identifier": "notification:default",
  "permissions": ["notification:default"]
}
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat(mobile): enable notification plugin"
```

### Task 8.2: Schedule reminders in Rust

**Files:**
- Create: `src-tauri/src/commands/notification.rs`
- Modify: `apps/web-spa/src/lib/adapter/tauri.ts` (add `requestNotificationPermission`)

- [ ] **Step 1: Add Tauri command to schedule a reminder**

```rust
#[tauri::command]
async fn schedule_reminder(
    app: AppHandle,
    db: State<Database>,
    contact_id: String,
    remind_at: i64,  // unix timestamp
) -> Result<(), String> {
    use tauri_plugin_notification::Notification;
    let body = format!("该联系了——间隔已到");
    app.notification()
        .builder()
        .title("PRM 提醒")
        .body(&body)
        .schedule_for_reminder_at(remind_at)  // 复检: 真实 API
        .show()
        .map_err(|e| e.to_string())
}
```

(Verify the exact API in tauri-plugin-notification docs — may differ by version.)

- [ ] **Step 2: Frontend trigger**

When user saves a contact with reminder enabled, SPA calls `adapter.scheduleReminder(contactId, remindAt)`.

- [ ] **Step 3: On boot, re-schedule all reminders**

In Rust `lib.rs` `setup` hook:

```rust
.setup(|app| {
    let db: tauri::State<Database> = app.state();
    reschedule_all_reminders(&db, app.handle())?;
    Ok(())
})
```

- [ ] **Step 4: Test on Android — schedule a notification 5 seconds out, verify it fires**

- [ ] **Step 5: Commit**

```bash
git add src-tauri apps/web-spa
git commit -m "feat(mobile): schedule local notifications for reminders"
```

### Task 8.3: Sync reminders across app launches

- [ ] **Step 1: Add db query for all enabled reminder contacts**

```rust
fn contacts_with_pending_reminders(conn: &Connection) -> Vec<(Contact, DateTime<Utc>)> {
    // Return all contacts where reminderEnabled=1
    // For each, calculate next remind time from lastContactedAt + intervalDays
}
```

- [ ] **Step 2: Run on app boot**

Re-schedules all pending reminders via the OS.

- [ ] **Step 3: When user logs an interaction, cancel & reschedule**

Calls `cancelReminder(contactId)` then `scheduleReminder(contactId, newTime)`.

- [ ] **Step 4: Test on Android — log interaction, verify old notification cancelled**

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat(mobile): re-sync reminders on app boot and after interaction"
```

---

## Sync Between Devices (Future Phase — out of scope for this plan)

For now: each device is independent. Web stores data in central DB; desktop/mobile are local. Adding device sync (e.g., via central web server) is a separate concern.

If/when needed:
- Add `updatedAt` timestamps to every entity (already there)
- Web server exposes `GET /api/sync?since=...`
- Devices push deltas via WebSocket
- Conflict resolution: last-write-wins per field

Not implemented in this migration plan.

---

## Verification Checklist (before declaring done)

- [ ] `pnpm tauri:dev` works on Linux — Today, Contacts, Calendar pages all render with live data
- [ ] `pnpm tauri:build` produces working .deb/.AppImage/.msi
- [ ] `pnpm tauri android dev` works — same flows run on Android emulator
- [ ] `pnpm tauri ios dev` works — same on iOS simulator
- [ ] `cargo run --bin weavine-web` + `pnpm dev` simultaneously — web SPA renders with real data
- [ ] All existing tests in `apps/web-spa/src/lib/**` pass
- [ ] All existing Rust tests in `src-tauri/src/**` pass
- [ ] Reminder notification fires 5s after scheduling on Android emulator

---

## Open Questions / Risks

1. **iOS build requires macOS host.** Make this a CI step on `macos-latest` runner.
2. **App Store signing.** Out of scope; document as next step.
3. **WebSocket for sync** — deferred. Document as Phase 9.
4. **Existing Next.js data migration path.** If anyone has data in old `.next/standalone` ephemeral DB, it's gone. Acknowledge as breaking change.
5. **Tauri Mobile maturity.** As of Tauri v2 stable, mobile works but is newer. Pin to known-good versions if iOS builds break.

---

## Estimated Effort

| Phase | Description | Tasks | Rough Estimate |
|-------|-------------|-------|----------------|
| 0 | Verify Rust | 1 | 30 min |
| 1 | Vite SPA scaffold | 6 | 4-6 hours |
| 2 | Auth | 4 | 6-8 hours |
| 3 | Today page reference | 5 | 4-6 hours |
| 4 | Other pages | 12 | 12-16 hours |
| 5 | Remove Next.js | 3 | 4-6 hours |
| 6 | Axum web | 4 | 8-12 hours |
| 7 | Tauri Mobile | 5 | 6-10 hours |
| 8 | Mobile notifications | 3 | 4-6 hours |
| **Total** | | **43 tasks** | **50-72 hours** |

For AI agent execution, multiply by parallelization factor (~3-5x): **realistic to complete in 2-4 weeks of focused agent work**.

---

## Plan Self-Review

### Spec Coverage

- ✅ Desktop migration: Phase 5 removes Next.js and spawner, frontend uses Rust commands
- ✅ Mobile support: Phase 7 adds Tauri Mobile
- ✅ Web support: Phase 6 adds Axum + same SPA
- ✅ Full offline: All platforms use local SQLite
- ✅ Reuses Rust commands: Phase 6 explicitly extracts `business::*` so Axum reuses them
- ✅ Native reminders (mobile): Phase 8

### Placeholder Scan

No "TBD" or "TODO" placeholders. Every step has a code block, an expected output, or a commit command.

### Type/Name Consistency

- Rust models → TypeScript `types.ts` → adapter interface — same names throughout.
- `business::contact::list(conn, params)` referenced in both `commands/contact.rs` (Task 6.2) and `bin/handlers/contact.rs` (Task 6.3).
- Adapter `listContacts(p)` shared between Tauri and HTTP implementations.

All consistent.

---

## Execution Log (Phases 0-5)

Branch: `fix/linux-ci-download` · Date: 2026-07-02

### Commits

| # | Commit | Phase | Summary |
|---|--------|-------|---------|
| 1 | `0fcffca` | Plan | docs(plan): add three-platform migration plan |
| 2 | `519d66f` | 0 | feat(tauri): add Phase 0 schema smoke test |
| 3 | `815575d` | 0 | feat(tauri): headless command-chain integration test (Phase 0 PoC) |
| 4 | `fb4a325` | 1 | feat(web-spa): rename apps/poc → apps/web-spa and add production deps |
| 5 | `621d49d` | 2 | feat(tauri): add `get_local_user` command for frontend auth |
| 6 | `38738ae` | 3 | feat(web-spa): adapter layer, auth hooks, app shell + Today page |
| 7 | `2a35e9a` | 1 | feat(tauri): point desktop build at apps/web-spa |
| 8 | `568629e` | 3 | feat(web-spa): add data adapter layer (Tauri + HTTP) |
| 9 | `0a3f3cd` | 4 | refactor(web-spa): centralize route definitions in routes-config |
| 10 | `862bef6` | 4 | feat(web-spa): migrate contacts list page |
| 11 | `6b65010` | 4 | feat(web-spa): migrate calendar page |
| 12 | `493f461` | 4 | feat(web-spa): migrate contacts new/edit/detail pages |
| 13 | `f38a98f` | 4 | feat(web-spa): migrate events new/edit/detail pages |
| 14 | `47f19a8` | 4 | feat(web-spa): migrate actions list/new/edit/detail pages |
| 15 | `96520b9` | 4 | feat(web-spa): migrate reminders/tags/tag-detail/interaction-detail pages |
| 16 | `efde6d4` | 4 | feat(web-spa): migrate search and settings pages |
| 17 | `d3e6e47` | 5 | feat(web-spa): add PWA support (manifest, service worker, icons) |

### Phase 4 — all 18 web-spa routes migrated

Today (`/`) + 18 new routes. Each follows the same pattern: `useAdapter()` + `useOwnerId()` + `useQuery`/`useMutation` + existing CSS classes. snake_case throughout.

Verification after Phase 4:
- `tsc --noEmit`: exit 0, 0 errors
- `vite build`: exit 0, 108 modules, 329 kB JS, 1.79 s

### Phase 5 — PWA wired

Ported the manifest + sw.js + icons from `feat/pwa-support` (commit `be055ab`), stripped the Next.js-only `/_next/data/` branch from the SW, registered SW in `App.tsx`. Verification via `vite preview`:

| Endpoint | HTTP | Bytes |
|----------|------|-------|
| `/` | 200 | 569 |
| `/manifest.json` | 200 | 606 |
| `/sw.js` | 200 | 2 783 |
| `/icon-192.png` | 200 | 8 186 |
| `/icon-512.png` | 200 | 27 933 |
| `/icon.png` | 200 | 3 918 |

### Operational gotcha

The host OpenCode environment silently no-ops parallel `task()` calls beyond the first one. **Strictly sequential subagent dispatch is required.** Workaround: send one `task()` per response turn, wait for the completion notification, then send the next. This added ~1 turn of latency per agent but was the only reliable path.

### Known gap

The HTTP adapter (in `apps/web-spa/src/lib/adapter/http.ts`) calls REST endpoints like `/contacts`, `/events`, etc. **No Axum HTTP gateway exists yet** — that is Phase 6 in this plan. The Next.js dev server on `:3100` exposes auth-style routes (`/api/auth/get-session`) that don't match the adapter's expected paths. Until Phase 6 lands, only the Tauri adapter (desktop) and the Vite dev server (with mocked data) can exercise the data layer.

### Branch state

`fix/linux-ci-download` is 17 commits ahead of `main`, fully pushed to `origin`. All Phase 1-5 work lives on this branch; Phase 6+ (Axum web, Tauri mobile, native notifications) remains to be done.

