# PRM Multi-User Implementation Plan

**Date:** 2026-06-17
**Status:** Done
**Tracks:** 2026-06-17-prm-multi-user-design

## Phase 1 — Schema (DONE)

1. `prisma/schema.prisma` — added `User`, `Account`, `Session`, `VerificationToken`, `Setting`, `PushSubscription`; added `ownerId` and per-owner uniques/uniques to all 8 domain models.
2. Switched provider to `postgresql`.
3. Removed `prisma/sql/{fts5.sql,apply.ts,push.sql}` (raw SQLite helpers no longer needed).
4. Updated `prisma/seed.ts` to create a local `User` row and stamp every seeded row with its `ownerId`.

## Phase 2 — Auth (DONE)

1. `pnpm add next-auth@beta @auth/prisma-adapter`.
2. `auth.config.ts` — edge-safe WeChat provider + `authorized` callback.
3. `auth.ts` — `PrismaAdapter`, JWT strategy, WeChat identity plumbing into `User`.
4. `src/middleware.ts` — Auth.js middleware with public-route allowlist.
5. `src/lib/auth/session.ts` — DAL with `React.cache()`.
6. `src/app/api/auth/[...nextauth]/route.ts` — exports `handlers.GET` and `handlers.POST`.
7. `src/app/login/page.tsx` — WeChat sign-in button.
8. `src/types/next-auth.d.ts`, `src/types/wechat-profile.d.ts` — module augmentation.

## Phase 3 — Service Layer (DONE)

Updated all 8 services to take `ownerId` as first arg, with `updateMany` / `deleteMany` enforcing ownership on writes.

## Phase 4 — Cron / API / Search (DONE)

1. `src/server/cron.ts` — iterates per-user, uses Prisma `pushSubscription`.
2. `src/server/search/executor.ts` — Postgres-style `contains` + `mode: 'insensitive'` filtered by `ownerId`. `SearchService.run` accepts `ownerId` first.
3. `/api/export` — filters by `ownerId`, reads `Setting` table.
4. `/api/push/subscribe` — Prisma upsert bound to `ownerId`.

## Phase 5 — Server Actions (DONE)

All 8 server-action files call `getCurrentUser()` and pass `ownerId` to services. `settings/actions.ts` no longer touches the filesystem.

## Phase 6 — UI (DONE)

- `src/app/layout.tsx` — uses `getCurrentUser()` and `ContactService.listAll`.
- `src/components/top-nav.tsx` — user avatar + sign-out button.

## Phase 7 — Config (DONE)

- `next.config.mjs` — `allowedOrigins` from `NEXT_SERVER_ALLOWED_ORIGINS`.
- `.env`, `.env.example` — added `AUTH_*`, `NEXT_SERVER_ALLOWED_ORIGINS`, switched to `postgresql+asyncpg://`.

## Phase 8 — Docs (DONE)

- `README.md` rewritten.
- `docs/superpowers/specs/2026-06-17-prm-multi-user-design.md` created.
- `docs/superpowers/plans/2026-06-17-prm-multi-user-implementation.md` (this file).

## Verification Steps

1. `pnpm prisma migrate dev --name init` against the local Postgres.
2. `pnpm build`.
3. `pnpm db:seed` to create a local user (auth still required to sign in).
4. Sign in via WeChat on `/login` (requires real AppID/AppSecret).
5. Create a contact / action / event — confirm they appear under the signed-in user.
6. Sign out — confirm middleware redirects to `/login`.

## Known Gaps

- No `local-user` fallback login — must use real WeChat AppID. To preview the UI without WeChat, set `isLocal: true` directly in the DB and bypass middleware.
- No automated e2e for the WeChat callback yet (Playwright stub exists).
- `pnpm test` may still reference old service signatures; service tests need updating alongside this change.
