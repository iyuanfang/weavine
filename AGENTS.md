# AGENTS.md — AI agent guidelines for this repo

## Two-stack architecture (decided 2026-07-05)

- **Desktop** (`src-tauri/`) — Tauri app, single user, SQLite (`weavine.db`), camelCase columns, rusqlite, `business/` direct queries.
- **Cloud** (`server/`) — weavine-server binary, multi-user, Postgres, snake_case columns, sqlx 0.8, handlers call `sqlx::query` directly.
- **Shared**: only `weavine_lib::models` (structs + `#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]`).
- **Do not** try to introduce a `trait Repo` / shared DAL until v0.2.0c sync schema stabilizes. Schema is still evolving (column renames, new sync columns) — abstracting now means re-abstracting later.

## Sync v0.2.0b — schema migration (2026-07-05)

When `feature/sync-v0.2` runs against a fresh database, migrations `20260705000001` through `20260705000004` auto-apply on service start.

**All migrations use TEXT columns** (no UUID PG types) to keep sqlx bindings simple (`&String` → PG TEXT). IDs are still generated as UUID strings via `gen_random_uuid()::TEXT` in DEFAULT expressions.

Schema after full migration:
- All PK/FK columns remain `TEXT` (unchanged from initial schema)
- `contact.user_id` / `tag.user_id` / etc. renamed from `owner_id` (migration 0002)
- Every domain table gains `server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq')` and `deleted_at TEXT`
- `contact_tag` and `project_contact` gained an `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT` column (needed for sync triggers)
- New tables: `devices`, `sync_manifest`, `sync_change_log`, `sync_meta`
- 11 sync triggers emit changes into `sync_change_log`
- `user_account` is **not** dropped by migration 0001 — only `refresh_token` is dropped/recreated to add `device_id FK`. Existing users are preserved.
- Handler bindings are unaffected: `extract_auth` returns `String`, `.bind(&auth)` works as before.
