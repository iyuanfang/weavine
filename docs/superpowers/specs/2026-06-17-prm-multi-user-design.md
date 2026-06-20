# PRM Multi-User Architecture Design

**Date:** 2026-06-17
**Status:** Implemented
**Scope:** Add multi-tenant data isolation + Auth.js v5 with WeChat QR login to PRM.

## Goals

1. Each user sees only their own contacts, actions, events, interactions, reminders, tags, settings, and push subscriptions.
2. Login is via **WeChat QR scan only** (WebsiteApp flow). No password, no email magic link.
3. Code shape matches the Auth.js v5 two-file split (edge-safe `auth.config.ts` + Node-only `auth.ts`).
4. All eight domain services (contact, action, event, interaction, reminder, tag, birthday, timeline) take an `ownerId` parameter.
5. Replace the raw-SQLite `push_subscription` table with a Prisma `PushSubscription` model bound to `ownerId`.
6. Replace the `prisma/settings.json` file with a per-user `Setting` Prisma model.
7. Layout / TopNav / middleware / DAL all read from a single `getCurrentUser()` source.

## Schema

New `User` model:

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  wechatUnionId String? @unique
  openidWeb     String? @unique
  openidMini    String? @unique
  isLocal       Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  accounts      Account[]
  sessions      Session[]
  contacts      Contact[]
  events        Event[]
  interactions  Interaction[]
  actions       Action[]
  reminders     Reminder[]
  tags          Tag[]
  contactTags   ContactTag[]
  eventAttendees EventAttendee[]
  pushSubscriptions PushSubscription[]
  settings      Setting[]
  @@index([wechatUnionId])
}
```

Auth.js adapter tables: `Account`, `Session`, `VerificationToken` (per Auth.js docs).

Every domain model gets:

```prisma
ownerId String
owner   User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
```

Uniqueness is now per-owner:

- `Tag.@@unique([ownerId, name])`
- `Contact.@@unique([ownerId, email])`

New tables replacing filesystem state:

- `Setting(ownerId, key, value)` — replaces `prisma/settings.json`.
- `PushSubscription(ownerId, endpoint, p256dh, auth)` — replaces raw SQLite `push_subscription`.

Cascade on owner delete cleans up everything.

## Auth

- Auth.js v5 (`next-auth@5.0.0-beta.31`) with `@auth/prisma-adapter`.
- Two-file split:
  - `auth.config.ts` (edge-safe) — providers, `pages`, `authorized` callback.
  - `auth.ts` — `PrismaAdapter`, JWT session strategy, `jwt` and `session` callbacks that populate WeChat identity on `User`.
- `WeChat` provider from `next-auth/providers/wechat` (WebsiteApp flow, the default).
- Middleware (`src/middleware.ts`) wraps `NextAuth(authConfig)` and the `authorized` callback redirects unauthenticated users to `/login`.
- DAL (`src/lib/auth/session.ts`): `getCurrentUser()` cached via `React.cache()`; throws `redirect("/login")` if missing.
- Login page: simple `signIn("wechat", { callbackUrl: "/today" })` button.
- TopNav: shows user avatar (or initial) + sign-out button.

### JWT vs DB session

JWT strategy chosen because:
- The Prisma adapter does not need to be edge-compatible in our setup.
- DB session would force a DB roundtrip on every middleware check.
- Logout-everywhere is not a requirement at this stage.

## Service Layer

Every method now takes `ownerId` as the first argument:

```ts
ContactService.create(ownerId, input)
ContactService.get(ownerId, id)
ContactService.list(ownerId, filter)
ContactService.update(ownerId, id, input)
ContactService.remove(ownerId, id)
ActionService.kanban(ownerId)
ActionService.today(ownerId)
EventService.create(ownerId, input)
InteractionService.log(ownerId, input)
ReminderService.dueReminders(ownerId | null)
TagService.list(ownerId)
BirthdayService.ensureBirthdayReminders(ownerId)
TimelineService.forToday(ownerId)
```

Writes use `updateMany` / `deleteMany` filtered by `{ id, ownerId }` and assert `count > 0`, throwing `NotFoundError` on miss. This is the cheapest correct way to enforce ownership without a separate read.

## Search

Old path used SQLite FTS5 + raw `better-sqlite3`. Replaced with Prisma `contains` + `mode: 'insensitive'` filtered by `ownerId`. Acceptable trade-off for our data scale; Postgres `tsvector` can be added later.

## Cron

`src/server/cron.ts` rewritten to use Prisma `pushSubscription` (no more raw `Database` open). Birthday, stale-contact, and reminder-dispatch loops iterate all users.

## API Routes

- `/api/auth/[...nextauth]` — Auth.js handlers.
- `/api/export` — filters all data by `ownerId`.
- `/api/push/subscribe` — uses Prisma `pushSubscription.upsert`, bound to `ownerId`.
- `/api/search` — passes `ownerId` into `SearchService.run`.
- `/api/contacts/[id]/interactions` — takes `ownerId` from session.

## Settings

`prisma/settings.json` removed. `Setting` Prisma model stores per-user JSON blob under `key='app'`. `readSettings()` / `writeSettings()` now go through Prisma and scope by `ownerId`.

## Next.js Config

`next.config.mjs` reads `NEXT_SERVER_ALLOWED_ORIGINS` env var (default `localhost:3000,localhost:3100`) so the same build can be deployed to multiple domains.

## Out of Scope

- Mini-program login (deferred; `wechatUnionId` schema field reserved).
- Email/password login (deferred per user choice).
- WeChat unionid-based account linking across web + mini (deferred).
- Per-user data export, per-user backups, per-user AI features.

## Acceptance Criteria

- [x] Schema migrated cleanly into Postgres.
- [x] `pnpm build` passes.
- [x] All services return only rows for the current `ownerId`.
- [x] `/login` shows a WeChat sign-in button.
- [x] Middleware redirects unauthenticated users to `/login`.
- [x] `getCurrentUser()` is the single source of truth for the current user.
- [x] TopNav shows the signed-in user and a sign-out button.
