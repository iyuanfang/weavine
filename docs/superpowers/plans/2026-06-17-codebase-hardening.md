# Codebase Hardening — Iteration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all P0/P1 issues from 4-way codebase audit (dead code, schema, performance, error handling)

**Architecture:** Independent parallel work units — each task touches disjoint files. No sequential dependencies.

**Tech Stack:** Next.js 14.2.5, Prisma 5.18 (SQLite), Tailwind CSS 3.4

---

### Task 1: EventForm — Add saving/error states

**Files:**
- Modify: `src/components/event-form.tsx`
- Modify: `src/app/events/new/page.tsx`
- Modify: `src/app/events/[id]/edit/page.tsx`
- Test: build only

- [ ] **Read event-form.tsx**

- [ ] **Add saving + error state to event-form.tsx**: Wrap `<form>` with `onSubmit` handler. Add `useState(saving)`, `useState(error)`, disable button while saving, show error inline. Call server action directly, check `ActionResult` return.

- [ ] **Ensure new/edit page passes server action**: Pages already pass `createEventAction`/`updateEventAction`. The form needs to accept the action prop and the `initial` prop.

- [ ] **Build + verify no regressions**: `pnpm build`

---

### Task 2: Delete confirmations — All 5 locations

**Files:**
- Modify: `src/components/interaction-timeline.tsx`
- Modify: `src/app/actions/[id]/page.tsx`
- Modify: `src/app/events/[id]/page.tsx`
- Modify: `src/app/tags/page.tsx`
- Read: `src/app/contacts/[id]/page.tsx`
- Test: build only

- [ ] **Read each file and add `confirm()` before each delete**: In `interaction-timeline.tsx` (DeleteButton), `actions/[id]/page.tsx`, `events/[id]/page.tsx`, `tags/page.tsx`, `contacts/[id]/page.tsx`. Pattern: `onClick={() => { if (!confirm('确认删除？')) return; action(); }}`

- [ ] **Build**: `pnpm build`

---

### Task 3: Remove dead code — DashboardService + inbox leftovers

**Files:**
- Modify: `src/app/dashboard/page.tsx` (if referenced)
- Modify: remove references in `src/server/services/dashboard.ts` (or delete file if unused)
- Test: build

- [ ] **Search for DashboardService usage**: `grep -r 'DashboardService' src/ --include='*.ts' --include='*.tsx'`

- [ ] **Delete or prune**: If DashboardService has zero imports outside its own file, delete the service file and any page/routes that reference it.

- [ ] **Build verify**: `pnpm build`

---

### Task 4: Tags actions — Add try/catch + error handling

**Files:**
- Modify: `src/app/tags/actions.ts`
- Modify: `src/app/tags/page.tsx`
- Test: build

- [ ] **Read tags/actions.ts**: Currently no try/catch on `createTag`, `renameTag`, `deleteTag`.

- [ ] **Add try/catch to each action**: Wrap in try/catch, return `ActionResult` on error. For `deleteTag` return `{ ok: true }` on success or `revalidatePath` then `redirect`.

- [ ] **Build**: `pnpm build`

---

### Task 5: ZodError handling — Map to user-friendly messages

**Files:**
- Modify: All server actions in `src/app/contacts/actions.ts`, `src/app/calendar/actions.ts`, `src/app/actions/actions.ts`
- Read: validation schemas in services
- Test: build

- [ ] **Audit all catch blocks**: Find all server actions that do `z.parse()` and catch with `instanceof ValidationError` but miss `ZodError`.

- [ ] **Add ZodError handling**: In each catch block, add `if (e instanceof ZodError) return { ok: false, error: e.errors[0]?.message || '验证失败' }`;

- [ ] **Build**: `pnpm build`

---

### Task 6: Schema indexes — Add missing indexes

**Files:**
- Modify: `prisma/schema.prisma`
- Execute: `pnpm db:push`

- [ ] **Read schema Contact model**: Add `@@index([lastContactedAt, updatedAt])` and `@@index([birthdayMonth, birthdayDay])`

- [ ] **Read schema Reminder model**: Add `@@index([contactId, kind, triggerAt])`

- [ ] **Run db push**: `pnpm db:push`

- [ ] **Build + test**: `pnpm build && pnpm test`

---

### Task 7: FullCalendar dynamic import

**Files:**
- Modify: `src/app/calendar/page.tsx`
- Test: build

- [ ] **Read calendar/page.tsx**: Replace `import CalendarView from` with `const CalendarView = dynamic(() => import('@/components/calendar-view'), { ssr: false })`

- [ ] **Add import**: `import dynamic from 'next/dynamic'`

- [ ] **Build verify**: `pnpm build`

---

### Task 8: Remove unnecessary 'use client' from event-form.tsx

**Files:**
- Modify: `src/components/event-form.tsx`
- Test: build

- [ ] **Read event-form.tsx**: Confirm no hooks used. Remove `'use client'` directive.

- [ ] **Build**: `pnpm build`

---

### Task 9: Contact.email @unique + enum types

**Files:**
- Modify: `prisma/schema.prisma`
- Execute: `pnpm db:push`

- [ ] **Add `@unique` to `Contact.email`**: `email String? @unique`

- [ ] **Add Prisma enums**: `EventType`, `ActionStatus`, `ReminderKind`. Update model field types. Update Zod schemas to match.

- [ ] **Run db push**: `pnpm db:push`

- [ ] **Build + test**: `pnpm build && pnpm test`

---

### Task 10: Add route-level error.tsx + loading.tsx for missing routes

**Files:**
- Create: `src/app/calendar/error.tsx`, `src/app/contacts/new/error.tsx` etc.
- Create: matching loading.tsx for routes missing them
- Test: build

- [ ] **Create missing error.tsx files**: One reusable pattern copied for: `/calendar`, `/contacts/new`, `/contacts/[id]/edit`, `/actions/[id]`, `/actions/new`, `/events/new`, `/events/[id]/edit`, `/settings`, `/tags`, `/search`

- [ ] **Create missing loading.tsx files**: For same routes (matching existing skeleton style)

- [ ] **Build**: `pnpm build`
