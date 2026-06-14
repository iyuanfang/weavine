# PRM · Personal Relationship Manager

Local-first single-user 人脉管理 Web App。Next.js 14 + Prisma + SQLite, all data in a single file at `prisma/dev.db`.

## Quick start

```bash
pnpm install
pnpm db:push           # create SQLite schema
pnpm db:seed           # optional demo data
pnpm dev               # http://localhost:3000
```

## Tests

```bash
pnpm test              # unit + service (Vitest)
pnpm test:e2e          # Playwright (requires dev server)
```

## Web Push setup (optional)

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys
```

Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private key in `VAPID_PRIVATE_KEY` of `.env`. Then in the app, click "开启浏览器通知" on the home page.

## Backup

```bash
cp prisma/dev.db backup-$(date +%F).db
cp backup-2026-06-14.db prisma/dev.db
pnpm exec tsx prisma/sql/apply.ts   # restore FTS5 triggers if lost
```

## See also

- `docs/superpowers/specs/2026-06-14-prm-design.md` — design spec
- `docs/superpowers/plans/2026-06-14-prm-implementation.md` — implementation plan
