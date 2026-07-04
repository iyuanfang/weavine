# Multi-Device Sync & Auth (v0.2.0) — Product Design

## 0. Scope & Goals

Currently Weavine is single-device: each desktop install runs its own SQLite and talks to nothing. The user wants the option to flip on a server-backed mode that:
- Lets the **same person** use multiple devices (laptop + 备用 laptop) and see the same data.
- Keeps the **default** behavior zero-friction (open the app, see data, no sign-in screen in the way).
- Hosts on `https://weavine.financialagent.cc/weavine/...` (reverse-proxied by the existing site at that domain; certificate already shared with the rest of the site).
- Reuses the existing `prm` SQLite schema on the desktop, but pivots the **server** from SQLite to **PostgreSQL** (multi-user, online, scalable).

Out of scope this revision: OAuth (Google/Apple/Microsoft), real-time push (websockets), team/sharing, granular permissions, billing, mobile Tauri-shell builds.

## 1. High-Level Architecture

```
DESKTOP (Tauri webview)                 SERVER (this repo + Postgres)         USER
+---------------------+                 +---------------------------+        +----------+
| TauriAdapter        |                 | weavine-server (Rust)     |        | Browser  |
| (in tauri.ts)       |                 |  - axum HTTP + TLS term   | <----- | https:// |
|  ↓                  | <-----HTTPS----> |  - sqlx → Postgres       |        | weavine. |
| HttpAdapter /api    |                 |  - JWT issuance & rotate  |        | fin...cc |
|  ↓                  |                 |  - sync endpoints         |        |          |
| Local SQLite        |                 |  - per-user Postgres rows |        |          |
|  / sync_meta        |                 |  - bcrypt hashed passwords|        |          |
+---------------------+                 +---------------------------+        +----------+
```

Both sides are Rust. The Tauri shell already ships `src-tauri/`. The server is a new sibling: `server/` (or `cloud/`), a separate cargo crate sharing domain types via a path dep on `src-tauri`'s `weavine_lib`.

## 2. Decisions (locked-in)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Auth = email + password**, bcrypt cost 12, JWT access + refresh tokens. OAuth later. | Self-contained, no external service dep. Mirrors user's "keep it simple" stance for v0.x. |
| D2 | **DB split**: desktop keeps local **SQLite**, server uses **PostgreSQL 16**. | Desktop offline-first + zero-setup; server multi-tenant. One business schema translated in two SQLs. |
| D3 | **Sync = watermark-based snapshot delta, per-row LWW.** | HTTP-only, no websocket infra, ~20ms typical sync. Per-row is fine for personal-use concurrency (you can't edit same contact on two laptops simultaneously, usually). |
| D4 | **Trigger = push on local change + pull on app launch + background pull every 5 min.** | No manual button. Reactive but bounded. |
| D5 | **Tombstones = reuse `archived_at`** for soft-delete (already in v0.1.7). | No new schema. Archived_from syncs as a normal field. |
| D6 | **No E2E encryption.** TLS-only. | Adds complexity disproportionate to PRM threat model. Documented trade-off. |
| D7 | **Single account per email; up to 10 devices per account.** | Personal tool. 10 device limit prevents abuse. |
| D8 | **"Local claim" model**: new accounts start with an empty server-side bucket. First-time sync uploads the local SQLite contents as the initial dataset (no merge needed because the server has nothing). | Avoids a complex first-sync resolution. |
| D9 | **Schema sync = server-owned.** Server's tables have version columns; clients check server version on `/sync/manifest` and bail if mismatch. | Avoids split-brain. |

## 3. Sub-Project 0 — Infrastructure (one-shot release before auth)

### 3.1 Deployment

```
   ┌── existing nginx / Caddy on weavine.financialagent.cc ──┐
   │                                                          │
   │  https://weavine.financialagent.cc/                      │  ← existing cert via Cloudflare or Let's Encrypt
   │     └── (static site; untouched)                        │
   │                                                          │
   │  https://weavine.financialagent.cc/weavine/...  → 127.0.0.1:8401/weavine/..│  ← NEW reverse-proxy block
   │                                                          │
   └──────────────────────────────────────────────────────────┘
```

- Domain: `https://weavine.financialagent.cc/weavine/...` (path-prefixed under existing site; cert shared; no second DNS record needed).
- Server listens on `127.0.0.1:8401`, behind nginx with `proxy_pass http://127.0.0.1:8401;` plus the usual `proxy_set_header X-Forwarded-*` and `client_max_body_size 25m;`.
- Work dir on the VPS: `/www/weavine/` (matches user's directive).
- Systemd unit `weavine-server.service` running the new `weavine-server` binary as user `weavine`.

### 3.2 Postgres

- Postgres 16 installed on the VPS via official Apt repo (`/etc/apt/sources.list.d/pgdg.list`).
- DB: `weavine`, owner `weavine`, password pulled from `/www/weavine/.env`.
- Migrations: `sqlx migrate run` against a directory `server/migrations/` (sqlx-cli). Both server startup runs migrations idempotent.
- Backups: `pg_dump` daily via cron → `/www/weavine/backups/daily.sql.gz`, retain 14. Push to S3-compatible offsite in v0.2.1.

### 3.3 Repo Layout (new)

```
prm/
  src-tauri/                ← existing desktop crate
  server/                   ← NEW
    Cargo.toml              (depends on weavine_lib by path)
    migrations/             (sqlx migrations targeting Postgres)
    src/
      main.rs               ← axum bootstrap, listen :8401
      db.rs                 ← PgPool
      auth/                 ← register, login, refresh, me
      sync/                 ← manifest, push, pull
      domain/               ← shared types from weavine_lib
      error.rs
      env.rs
```

### 3.4 What ships at v0.2.0

- `/weavine/health` → 200 + version
- `/weavine/v1/auth/register`
- `/weavine/v1/auth/login`
- `/weavine/v1/auth/refresh`
- `/weavine/v1/auth/me`
- `/weavine/v1/sync/manifest`
- `/weavine/v1/sync/push`
- `/weavine/v1/sync/pull`
- `/weavine/v1/devices` (list + delete = "sign out this device")

## 4. Sub-Project 1 — Auth

### 4.1 Data Model (Postgres)

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,            -- bcrypt cost 12
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,            -- e.g. "MacBook Pro 17"
    os           TEXT,                     -- "macOS 14.5" / "Windows 11"
    app_version  TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_id_idx ON devices(user_id);

CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash    BYTEA NOT NULL,          -- sha256 of opaque token
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_device_idx ON refresh_tokens(user_id, device_id);
```

### 4.2 Endpoints

| Path | Method | Body | Response | Errors |
|---|---|---|---|---|
| `/weavine/v1/auth/register` | POST | `{email, password, device: {name, os, app_version}}` | `{user_id, access_token, refresh_token, expires_in}` | 409 email-taken, 400 weak-password |
| `/weavine/v1/auth/login` | POST | `{email, password, device: {…}}` | same | 401, 429 rate-limit |
| `/weavine/v1/auth/refresh` | POST | `{refresh_token}` | `{access_token, refresh_token, expires_in}` | 401, 403 revoked |
| `/weavine/v1/auth/me` | GET | (bearer) | `{user_id, email, devices: [...], server_version}` | 401 |
| `/weavine/v1/devices` | GET/DELETE | bearer | list / `{deleted: true}` | 401 |

### 4.3 Tokens

- **Access token**: JWT, RS256, 15-min TTL, claims `{sub: user_id, dev: device_id, iat, exp}`. Public key distributed in app config (so desktop can verify offline).
- **Refresh token**: opaque 256-bit random, base64, 30-day TTL, stored hashed (sha256). Rotation: each refresh issues new pair; old refresh is revoked and replaced atomically (`UPDATE … WHERE revoked_at IS NULL AND expires_at > now`).
- **Rate limit**: 5 login attempts per (ip + email) per 15 min; 3 register per ip per hour; 1000 req/hour per access token (sliding window in Postgres).

### 4.4 Desktop Flow (linking existing local account to server)

1. User picks "Settings → 同步到云端" (new) → bottom of settings page.
2. Modal: register (email + password) OR login (email + password).
3. POST to server, receive tokens.
4. App stores tokens in OS keychain:
   - macOS: `Keychain Access` item name `com.weavine.prm.sync`
   - Linux: `secret-service` (libsecret/Gnome Keyring) — fallback: encrypted file at `~/.local/share/com.weavine.prm/sync-token.bin` (age-encrypted with a key derived from a password re-prompted once-per-launch is overkill; for v0.2 we'll use a **plain JSON** at `~/.config/com.weavine.prm/sync.json` with restricted perms, and document the security caveat).
   - Windows: DPAPI via `windows-rs` `CryptProtectData`.
5. App notes `linked_device_id = <device>` in the same JSON for `/devices`.
6. From this moment, the **TauriAdapter** wraps `weavine_lib::sync::run()` whenever the app boots, on focus, after every mutation, and every 5 minutes.

> Local "anonymous user" stays intact. Reversible: "Settings → 取消同步" deletes the credentials and the device row on server, but **leaves all local data**.

## 5. Sub-Project 2 — Sync Engine

### 5.1 Server Tables (per user)

The full PRM domain is split into per-user rows in Postgres. Existing business tables (`Contact`, `Action`, `Event`, `Project`, `Interaction`, `Reminder`, `Tag`, `ProjectContact`, `Setting`) get two new columns in their Postgres incarnation:

```sql
ALTER TABLE contact ADD COLUMN user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE contact ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE contact ADD COLUMN deleted_at TIMESTAMPTZ;     -- tombstone for hard-deletes (rare; archive covers 99%)
ALTER TABLE contact ADD COLUMN server_revision BIGINT NOT NULL DEFAULT 1; -- bumped on every server write
```

The server owns two meta tables:

```sql
CREATE TABLE sync_manifest (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    schema_version INT NOT NULL,          -- bump on any server schema change
    server_revision BIGINT NOT NULL,      -- monotonic, per-user; published on every push/pull
    last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_change_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity TEXT NOT NULL,                 -- 'contact' | 'action' | 'event' | …
    row_id UUID NOT NULL,
    op TEXT NOT NULL,                     -- 'upsert' | 'delete'
    server_revision BIGINT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_change_log_user_rev_idx ON sync_change_log(user_id, server_revision);
```

The trigger on every domain table fills `sync_change_log` automatically.

### 5.2 Endpoints

| Path | Body | Response |
|---|---|---|
| `POST /weavine/v1/sync/manifest` | (bearer) | `{schema_version, server_revision, last_updated}` |
| `POST /weavine/v1/sync/push` | `{since_revision, entities: [{kind, rows: [...]}]}` | `{accepted, latest_revision}` (per-row errors) |
| `POST /weavine/v1/sync/pull` | `{since_revision, limit}` | `{rows: [{kind, op, row}], latest_revision}` |

Client pull limit defaults to 500, max 2000 per call.

### 5.3 Conflict Resolution

- Per-row LWW. Client sends its `updated_at` per row; server compares to the row's `updated_at`. Newer wins, older is dropped.
- If a row has `deleted_at` set locally and the server version is `updated_at > now`-old, the row goes back to active — acceptable (rare for a personal app).
- Special re-resolve case: `archived_at` is just a field — no separate tombstone.

### 5.4 Desktop Sync Driver (in `weavine_lib::sync`)

```
pub struct SyncEngine {
    http: reqwest::Client,
    base_url: Url,
    tokens: RwLock<Tokens>,
    last_pulled_revision: AtomicU64,
    last_pushed_revision: AtomicU64,
}

impl SyncEngine {
    pub async fn push_local_changes(&self) -> Result<u64>;
    pub async fn pull_remote_changes(&self) -> Result<u64>;
    pub async fn sync_once(&self) -> Result<()>;  // push then pull
    pub fn schedule_background(&self);             // axum::spawn-equivalent on Tauri's tokio runtime
}
```

Hooks:
- After every mutation in `business/*.rs` writes, call `sync.push_local_changes().spawn()`.
- On app `ready`, call `sync.sync_once().spawn()`.
- On window `focus`, same.
- Background timer every 5 min via `tokio::time::interval`.

Local-side **watermark table**:

```sql
CREATE TABLE sync_meta (
    owner_id TEXT PRIMARY KEY,         -- local owner id (matches existing `users.local-default`)
    last_pulled_revision BIGINT NOT NULL DEFAULT 0,
    last_pushed_revision BIGINT NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMPTZ,
    last_error TEXT
);
```

Migration `009_sync.sql` adds this table on the desktop SQLite without touching existing rows.

### 5.5 Mapping Desktop ↔ Server Rows

- **Row id**: UUIDs are identical client-side and server-side. SQLite stores them as TEXT, Postgres as UUID. No translation.
- **Owner / user**: desktop has only one `user.id = "local-default"`. Once linked, every server-synced row carries `user_id = <server user_id>` in Postgres; the local SQLite copy stores the same UUID in `id` and adds a local `owner_id` that maps to the linked server user (or remains `local-default` if not linked).
- **Schema drift handling**: On `manifest`, if `schema_version != local_schema_version`, the client refuses to push and shows a banner: "服务端版本比你的桌面版新，请在桌面端升级或在桌面设置 → 取消同步 用单机模式"

### 5.6 Optimistic concurrency & idempotency

- Each push row carries a **client-side UUID** (the row id) plus a **client-local `updated_at`**. Server uses `(row_id, updated_at)` to skip rows already applied.
- Push is idempotent: re-sending the same row id is a no-op.

## 6. Sub-Project 3 — Desktop Integration

### 6.1 UI

- **Settings → 同步到云端** card:
  - 未登录：邮箱 + 密码 + 设备名 + "创建账号" 或 "登录"。
  - 已登录：当前设备名 + 服务器邮箱 + 列表中所有设备 + 每个设备 "移除" 按钮 + "退出所有设备" + "取消同步"（仅当前设备断开，保留其它设备）。
- **顶部 toast** when sync errors out (`last_error` populated). Click → 打开 dialog 显示重试或取消。
- 不抢主屏。首启 onboarding banner 仍可选（已存在的 v0.1.7 archive-tip-dismissed 风格）。

### 6.2 Adapter Layer

- `HttpAdapter` already exists; it gets a sibling `RemoteAdapter` that wraps `weavine_lib::sync` and selects base URL + bearer header.
- The app's `useAdapter()` stays a single hook. The selection logic:
  - If `~/.config/com.weavine.prm/sync.json` exists + valid tokens → **RemoteAdapter** (writes go to local SQLite **then** sync engine pushes).
  - Else → **HttpAdapter** (current, talks to `weavine-web` on `127.0.0.1:3000`).
- The Tauri shell still talks to its in-process local DB; the difference is that mutations also schedule a sync push.

### 6.3 Local Data Migration on First Link

The first push uploads the user's local SQLite contents as a one-shot:

```
sync.push_local_changes() on `link_account` triggers a full-table scan (since_revision = 0) → uploads everything.
```

Because the server starts with an empty bucket per user, no merge is needed. The very first sync **defines** the dataset.

If the user later unlinks and re-links with the same email (rare), the server doesn't accept the local copy to avoid blowing away their other devices' data — instead the server sends its full state to the local, and the user is informed: "已用服务端数据替换本地新内容" (since local was already empty after unlink probably).

## 7. Sub-Project 4 — Operations

### 7.1 Observability

- Server logs JSON to stdout (tracing-subscriber json layer). Systemd journal captures.
- Metrics: `GET /weavine/metrics` Prometheus endpoint (basic counters: requests per route, sync push/pull latency, auth failures).
- `GET /weavine/health` returns `{status: "ok", version, db: "ok"}`; checking `db` requires a `SELECT 1` against the pool.

### 7.2 Limits

- Per-user 200k rows across all entities.
- Per-payload 25 MB.
- 1000 requests/hour per access token.

### 7.3 Data Export / Account Delete (GDPR-aligned)

- `GET /weavine/v1/account/export` returns a zip of all user data in JSON.
- `POST /weavine/v1/account/delete` with password confirmation; soft-delete (30-day grace), then hard-purge. Devices token-revoked on contact.

These are scope-deferred to **v0.2.1**, not v0.2.0.

## 8. Tests

| Layer | Test | What it proves |
|---|---|---|
| Server: auth | register → login → me | password round trip |
| Server: auth | refresh-token rotation, replay rejected | refresh safety |
| Server: sync | push → pull → re-push idempotent | LWW correctness |
| Server: sync | two devices write simultaneously → both converge | conflict resolution |
| Server: schema | manifest mismatch → 409 | drift safety |
| Desktop: sync driver | off-line push queue replays when back online | offline queue |
| E2E (Playwright) | Register on device A, edit on device A, "other device" appears, edit on device B, A sees within 5 min | full-flow happy path |

## 9. Phased Rollout

| v | Scope | ETA |
|---|---|---|
| v0.2.0a | Sub-0 infra + Sub-1 auth (no sync yet; users can register but data stays local) | 1 weekend |
| v0.2.0b | Sub-2 sync engine live | +1 weekend |
| v0.2.0c | Sub-3 desktop integration, settings UI, first-link migration | +1 weekend |
| v0.2.0d | Sub-4 ops + Playwright E2E | +0.5 weekend |
| v0.2.1 | OAuth + offline-queue polish + account export/delete | later |
| v0.3+ | multi-user teams, sharing, real-time websocket | later |

## 10. Open Questions

1. **Email transport**: do we need a "verify email" flow on register, or is a magic-link password-reset good enough in v0.2.0?  Recommendation: **skip verification for v0.2.0**, add on demand.
2. **Server-side encryption-at-rest**: lean on Postgres transparent disk encryption (depends on VPS provider); document only; no v0.2.0 work.
3. **Single-tenant deployment**: only one VPS, one Postgres. Multi-tenant would change schema (per-tenant DB, sharded by `tenant_id`). Out of scope.
4. **Local SQLite and server Postgres schema diff**: should we maintain them as **one canonical SQL** that compiles to both, or hand-port each migration?  Recommendation: hand-port with a `server/migrations/<n>__<name>.sql` mirror, since `weavine_lib` types work for both.
5. **Mobile (Tauri iOS/Android)**: this design supports it (iOS Android token storage via OS keychain), but UI isn't built. v0.3.
6. **`/weavine/` path prefix**: TauriAdapter and HttpAdapter will see URLs starting with `/weavine/v1/...`. Make sure all call sites build paths with a configurable base.
7. **Sync quota**: 200k rows × ~500 bytes ≈ 100MB per user. Plenty of headroom; not a real limit.

## 11. Risk register

| Risk | Mitigation |
|---|---|
| `binary COPY` of local SQLite → server on first-link takes long for big accounts | upload in chunks of 1000 rows per push, show progress |
| Token leak on disk (plain JSON `sync.json`) | docs warning; proper OS-keychain in v0.2.1 |
| Server outage causes local-only writes to pile up | queue size cap (10k rows); user warned; queue trimmed to newest when over cap |
| Postgres password in `.env` is world-readable | `chmod 600 /www/weavine/.env`; systemd `EnvironmentFile=` |
| JWT secret rotation breaks all clients | keep a `prev_public_key` block of 30 days so old clients can still verify while refreshing |
| Initial push on slow link takes 30+ min | show progress; allow cancel; resume on next attempt |
