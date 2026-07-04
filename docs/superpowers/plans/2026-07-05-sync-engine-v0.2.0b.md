# Sync Engine v0.2.0b Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> Steps use checkbox (- [ ]) syntax.

**Goal:** Build sync engine (3 endpoints + 4 sync tables + 11 triggers + RS256 + devices) so desktop client can push/pull changes from server.

**Architecture:** Server (axum + sqlx + Postgres) adds sync_meta, sync_manifest, sync_change_log, devices; 11 domain tables get user_id UUID + server_revision + deleted_at + triggers auto-log to sync_change_log. RS256 JWT (private on server, public embedded client). 3 endpoints: POST /api/sync/{manifest, push, pull} with LWW conflict array. Desktop SyncEngine (Sub-Project 3) out of scope here.

**Tech Stack:** Rust 1.88+, axum 0.7, sqlx 0.8, jsonwebtoken 9 (RS256), openssl, uuid 1.x

**Spec:** docs/superpowers/specs/2026-07-05-sync-engine-v0.2.0b-design.md (read first for full context)

**Existing patterns to follow:**
- Handler signature: `async fn handler_name(headers: HeaderMap, State(pool): State<Arc<PgPool>>, Path/Json params) -> Result<Json<X>, (StatusCode, String)>`
- Auth: `let user_id = extract_auth(&headers)?;` returns `String` (parsed UUID)
- now_str() helper at handlers/mod.rs returns "YYYY-MM-DD HH:MM:SS"
- Migrations go to `server/migrations/NNNN_filename.sql`, applied via sqlx::migrate! on startup

---

## Phase 1: Schema + Crypto Foundation

### Task 1: Generate RS256 keypair
- [ ] `cd server && openssl genpkey -algorithm RSA -out jwt-private.pem -pkeyopt rsa_keygen_bits:2048`
- [ ] `openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem`
- [ ] `chmod 600 jwt-private.pem`
- [ ] Add `*.pem` to `server/.gitignore`
- [ ] Commit: `chore(server): gitignore JWT RSA keys`

### Task 2: Migration — user_account rebuild + devices table
File: `server/migrations/20260705000001_auth_and_devices.sql`
- [ ] DROP existing user_account + refresh_token (v0.2.0a has no FK)
- [ ] CREATE user_account with `id UUID PK DEFAULT gen_random_uuid()`, email UNIQUE, password_hash TEXT, created_at TEXT, updated_at TEXT
- [ ] CREATE devices per spec (id UUID PK, user_id UUID FK, name TEXT, os TEXT, app_version TEXT, last_seen_at TEXT, created_at TEXT, revoked_at TEXT NULLABLE)
- [ ] CREATE refresh_token with `device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE`, token_hash TEXT UNIQUE, expires_at TEXT, revoked_at TEXT NULLABLE, created_at TEXT

### Task 3: Migration — user_id UUID + server_revision + deleted_at (11 domain tables)
File: `server/migrations/20260705000002_domain_uuid_and_revisions.sql`
- [ ] CREATE SEQUENCE IF NOT EXISTS server_revision_seq START 1
- [ ] For each of 11 domain tables (contact, tag, contact_tag, project, project_contact, event, action, interaction, reminder, setting, push_subscription):
  - `ALTER TABLE x ALTER COLUMN owner_id TYPE UUID USING owner_id::UUID`
  - `ALTER TABLE x RENAME COLUMN owner_id TO user_id`
  - `ALTER TABLE x ADD COLUMN server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq')`
  - `ALTER TABLE x ADD COLUMN deleted_at TEXT`
- [ ] Verify: `psql \d+ contact` shows user_id uuid, server_revision bigint, deleted_at text

### Task 4: Migration — sync_meta + sync_manifest + sync_change_log + 11 triggers
File: `server/migrations/20260705000003_sync_engine.sql`
- [ ] CREATE sync_meta (user_id UUID PK FK user_account, last_pulled_revision BIGINT, last_pushed_revision BIGINT, last_sync_at TEXT)
- [ ] CREATE sync_manifest (user_id UUID PK FK, schema_version INT, server_revision BIGINT, last_updated TEXT)
- [ ] CREATE sync_change_log (id BIGSERIAL PK, user_id UUID, device_id UUID NULLABLE, table_name TEXT, row_id TEXT, op TEXT CHECK, server_revision BIGINT, data JSONB, changed_at TEXT)
- [ ] Indexes: sync_change_log(user_id, server_revision), sync_change_log(user_id, table_name, server_revision)
- [ ] CREATE FUNCTION sync_log_change() — reads TG_TABLE_NAME, TG_OP, NEW/OLD; extracts device_id from `current_setting('app.current_device_id', true)` (NULLABLE)
- [ ] 11 CREATE TRIGGER statements (one per domain table) calling sync_log_change() AFTER INSERT OR UPDATE OR DELETE

---

## Phase 2: Code Refactor

### Task 5: Add uuid crate + JWT key loader
- Modify: `server/Cargo.toml` — add `uuid = { version = "1", features = ["v4", "serde"] }`
- Create: `server/src/auth_keys.rs` — load PEM from JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH env, return (EncodingKey, DecodingKey)
- [ ] Wire into main.rs: `let keys = auth_keys::load().expect("JWT keys");`
- [ ] Update systemd env to point at absolute paths
- [ ] Verify: `cargo check -p weavine-server` passes

### Task 6: Auth handler RS256 + device refactor
File: `server/src/handlers/auth.rs`
- [ ] Change EncodingKey/DecodingKey to use keys.encoding / keys.decoding
- [ ] Change Algorithm::HS256 to Algorithm::RS256 in encode() and decode()
- [ ] Add DeviceInfo struct: `{ name: String, os: String, app_version: String }`
- [ ] Refactor register: take `{email, password, device}` → create user → create device → create refresh_token (device_id FK) → return access+refresh
- [ ] Refactor login: take `{email, password, device}` → upsert device → create refresh_token → return access+refresh
- [ ] Update refresh to validate token belongs to non-revoked device
- [ ] Update me to also return devices[] (active only)
- [ ] Verify: `cargo check` + curl register with device payload

### Task 7: Mass handler rename owner_id to user_id (12 files)
Files: contact, event, action, project, project_contact, interaction, reminder, tag, setting, archive, search, diagnostic
- [ ] Replace owner_id with user_id everywhere (Rust vars + SQL refs)
- [ ] Change SQL params from &str to Uuid (parse at handler boundary)
- [ ] Add `SET LOCAL app.current_device_id = '<uuid>'` before every INSERT/UPDATE/DELETE
- [ ] Verify: `cargo check -p weavine-server` passes, no owner_id refs

---

## Phase 3: Sync Handlers

### Task 8: sync.rs manifest endpoint
File: `server/src/handlers/sync.rs` (new)
- [ ] Write `manifest(headers, State(pool)) -> Json<ManifestResp>`:
  - extract user_id from JWT
  - SELECT from sync_manifest WHERE user_id = $1
  - If no row: INSERT initial (schema_version=1, server_revision=0), return
  - Return `{schema_version, server_revision, last_updated}`

### Task 9: sync.rs push endpoint
File: `server/src/handlers/sync.rs` (modify)
- [ ] Write `push(headers, State(pool), Json(PushReq))`:
  - Extract user_id, validate device_id from body
  - For each entity in entities[]: BEGIN tx, SET LOCAL device_id, upsert with LWW
  - LWW: skip if existing.server_revision > push.server_revision
  - If push.updated_at > existing.updated_at: UPSERT + trigger bumps revision
  - Else: skip
  - Return `{accepted, conflicts: [{kind, row_id, reason}]}`
- [ ] Reject if device revoked (401)

### Task 10: sync.rs pull endpoint
File: `server/src/handlers/sync.rs` (modify)
- [ ] Write `pull(headers, State(pool), Json(PullReq))`:
  - Extract user_id, since_revision (default 0), limit (default 500, max 1000)
  - SELECT from sync_change_log WHERE user_id=$1 AND server_revision > $2 ORDER BY server_revision ASC LIMIT $3
  - For each row: join back to source table for current data; if deleted_at NOT NULL return op=DELETE with data=null
  - Return `{rows: [{kind, op, row_id, data, revision}], latest_revision, has_more}`
- [ ] Update sync_meta.last_pulled_revision after pull

### Task 11: Wire sync routes in main.rs
File: `server/src/main.rs`
- [ ] Add `use handlers::sync;`
- [ ] Add routes: `.route("/api/sync/manifest", post(sync::manifest))` etc.

---

## Phase 4: Deploy + Smoke Test

### Task 12: Server-side build on prod (per AGENTS.md)
- [ ] `ssh root@47.79.43.80`
- [ ] `cd /www/weavine/repo && git fetch && git checkout feature/sync-v0.2 && git pull`
- [ ] `cd src-tauri && cargo +1.88.0 build --release --bin weavine-web --no-default-features`
- [ ] `ldd target/release/weavine-web | grep -i glibc` (must be empty)
- [ ] `cp /www/weavine/weavine-web /www/weavine/weavine-web.v0.2.0a.bak`
- [ ] `mv target/release/weavine-web /www/weavine/weavine-web && chmod +x`
- [ ] Generate keys on prod: `cd /www/weavine && openssl genpkey -algorithm RSA -out jwt-private.pem -pkeyopt rsa_keygen_bits:2048 && openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem && chmod 600 jwt-private.pem`
- [ ] Update systemd env: JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH
- [ ] `systemctl restart weavine-web && sleep 3`
- [ ] `journalctl -u weavine-web --since "30 seconds ago" --no-pager | tail -20`

### Task 13: Curl smoke test
- [ ] `curl -s https://ai.financialagent.cc/api/health` → 200
- [ ] Register with device payload: `curl -X POST .../api/auth/register -d '{"email":"smoke@test.com","password":"...","device":{"name":"smoke","os":"linux","app_version":"0.2.0b"}}' -H 'Content-Type: application/json'`
- [ ] Login with device: `curl -X POST .../api/auth/login ...`
- [ ] Get access token, hit `curl -X POST .../api/sync/manifest -H 'Authorization: Bearer ...'` → returns manifest JSON
- [ ] Pull empty: `curl -X POST .../api/sync/pull -d '{"since_revision":0,"limit":100}' -H 'Authorization: Bearer ...'` → empty rows
- [ ] Create a contact via /api/contacts, then pull again → should see 1 row in change_log
- [ ] Push: `curl -X POST .../api/sync/push -d '{"since_revision":0,"device_id":"...","entities":[{"kind":"contact","rows":[...]}]}'`
- [ ] Verify psql: `SELECT COUNT(*) FROM sync_change_log` → 1+

### Task 14: Rollback if smoke fails
- [ ] `mv /www/weavine/weavine-web /www/weavine/weavine-web.broken-$(date +%s)`
- [ ] `mv /www/weavine/weavine-web.v0.2.0a.bak /www/weavine/weavine-web`
- [ ] `chmod +x /www/weavine/weavine-web && systemctl restart weavine-web`
- [ ] Migrations are forward-only; if rollback needed, drop sync tables manually via psql