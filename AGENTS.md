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
- `contact.user_id` / `tag.user_id` / etc. established column name (initial schema uses `user_id`)
- Every domain table gains `server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq')` and `deleted_at TEXT`
- `contact_tag` and `project_contact` gained an `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT` column (needed for sync triggers)
- New tables: `devices`, `sync_manifest`, `sync_change_log`, `sync_meta`
- 11 sync triggers emit changes into `sync_change_log`
- `user_account` is **not** dropped by migration 0001 — only `refresh_token` is dropped/recreated to add `device_id FK`. Existing users are preserved.
- Handler bindings are unaffected: `extract_auth` returns `String`, `.bind(&auth)` works as before.

## Activation tracking + per-install device_key (since v1.0.3)

Anonymous installs (Tauri / Web SPA, never logged in) register themselves with `weavine-server` so usage stats cover the full funnel, not just paying users.

**Schema** (migration `20260814000001_install_activation.sql` then `20260820000001_device_key.sql`):
- `install_activation` — one row per install. Columns: `install_id` (PK), `first_seen_at`, `last_seen_at`, `app_version`, `os`, `platform` (`desktop|android|web`), `last_ip_hash` (SHA-256 with `WEAVINE_JWT_SECRET`), `call_count`, `last_event`, `device_key` (UNIQUE partial idx where not null), `plan`, `daily_ocr_count`, `daily_voice_count`, `daily_reset_at`, `revoked_at`.
- The same `install_id` becomes `devices.id` after `register()` / `login()`, so `JOIN install_activation ON install_id = devices.id` reveals multi-device users. Older clients (no `device.install_id`) get a fresh UUID v4.

**Server endpoints**:
- `POST /api/activation/ping` — body `{install_id, app_version, os, platform}`. `ON CONFLICT (install_id) DO UPDATE` bumps `last_seen_at` + `call_count`. Returns `{ok, first_seen_at, call_count, device_key}` on first sight (mints a 32-char hex UUID v4).
- `record_activation_hook(install_id, event)` — called from `handlers/ocr.rs` and `handlers/voice.rs` after every cloud call. Updates `last_event` + `last_seen_at`.

**Auth precedence** (introduced v1.0.3, replaces the old `extract_auth(String)`):
```
extract_endpoint_auth() -> EndpointAuth
  = AnonymousDevice { install_id }  // when X-Device-Key matches install_activation.device_key
  | User { user_id, device_id }     // when JWT or API key is valid
  | ServiceKey                      // when X-Service-Key == WV_SERVICE_KEY (dev / CI only)
```
Order: `X-Device-Key` → `Authorization: Bearer ...` / `X-Api-Key` → `X-Service-Key`.

## Tauri command naming (since v1.3.5)

In `#[tauri::command]` blocks that take multiple scalar arguments (e.g. `user_id: String`, `note_id: String`), you **must** add `rename_all = "snake_case"`. Without it, Tauri 2's default expects camelCase JS arg keys (`{ userId, noteId }`) but the JS client uses snake_case (`{ user_id, note_id }`), and the user gets a confusing `missing required key userId` error from the bridge.

Commands that already had it (correct): `md_save_draft`, `md_finalize_import`. Commands fixed in v1.3.5: `md_check_import_status`, `md_export_note_as_md`. Rule of thumb: any new `#[tauri::command]` with >1 scalar param **must** include `rename_all = "snake_case"` — adding it later is a runtime-only failure with no compile-time warning.

**Client persistence**:
- Tauri: `<data_dir>/install_id` and `<data_dir>/device_key`, both read+written by `src-tauri/src/install_id.rs`. `setup()` spawns `spawn_first_launch_ping` 5 s after launch.
- Web SPA: `localStorage[weavine:install_id]` and `localStorage[weavine:device_key]`, managed by `apps/web-spa/src/lib/install-id.ts`. `fireFirstLaunchPing()` runs once after first render.

**Headers on every cloud call** (Tauri `commands/ocr.rs`, `commands/voice.rs`; Web SPA `installHeaders()`):
```
X-Device-Key:     <32-char hex>          // persisted, server validates against install_activation
X-Install-Id:     <UUID v4>              // for record_activation_hook
X-Client-Platform: desktop|android|web   // from process detection
X-Client-OS:      <os name string>
X-App-Version:    <weavine version>
```

**Privacy guarantees** (README "Activation tracking" section):
- Raw IP is never persisted — only `SHA-256(WEAVINE_JWT_SECRET || ip)`.
- `install_id` is client-minted UUID v4 — no fingerprint / no machine-id / no browser fingerprint.
- Only destination is the server URL the user has configured.
- Disabling: delete `<data_dir>/install_id` + `<data_dir>/device_key`, or clear `localStorage[weavine:install_id|weavine:device_key]`. Next launch = new install row.

**Queries**: `docs/activation.sql` ships 10 ready-to-use queries (DAU/MAU, platform breakdown, multi-device funnel, anon→logged-in cohort, daily quota reads for plan enforcement).

## Reminder scheduling (since v1.0.4)

The 30 s JS polling loop is gone in Tauri builds. Reminders are scheduled on the Rust side:

**Write path** — `commands/event.rs::create_event` / `update_event` and `commands/reminder.rs::create_reminder` / `update_reminder`:
```
business::event::create / update          // INSERT Event row
business::reminder::sync_event_reminder   // INSERT/DELETE Reminder row (auto from reminder_lead_minutes)
commands::notification::schedule_for_reminder
  └─ schedule_notification:
        tokio sleep(trigger_at - now - 5s)
        then claim_due_reminders()  // marks dispatched=1
        then app.notification().builder().show()  // OS NotificationManager / WinRT / NSUserNotification / libnotify
        then emit("weavine:reminder-fired", reminder)
```

**Catch-up** — `commands/notification::startup_catch_up()` is invoked from `lib.rs::setup()` immediately after `tauri_plugin_notification::init()`. It calls `business::reminder::list_pending()` (dispatched=0 AND dismissed=0) and `schedule_for_reminder` each. Handles "Android killed the app between sleep and fire".

**JS side** — `apps/web-spa/src/lib/use-reminder-poller.ts` branches on `isTauri()`:
- Tauri build: subscribe to `listen("weavine:reminder-fired", ...)` → dispatch `CustomEvent("weavine:reminder")`. `App.tsx` listener still owns the in-app banner.
- Browser standalone (no Rust): keeps the legacy `setInterval(tick, 30_000)` + `Web Notification API` path.

**Permissions**: Android 13+ requires `POST_NOTIFICATIONS` (already in `src-tauri/gen/android/app/src/main/AndroidManifest.xml`). Tauri capability `notification:default` already granted in `src-tauri/capabilities/default.json`.

## Hard rules (since v1.0.4)

- **Do not** add a JS-side polling fallback for reminders on Tauri builds — the Rust scheduler owns it. Polling burns battery and can double-fire (Rust already marks `dispatched=1`).
- **Do not** add non-`#[cfg(feature = "tauri")]` code under `commands/` — the desktop bin and the `weavine-web` bin reuse the `weavine_lib` crate but the web server doesn't link any Tauri plugin.
- `tauri-plugin-notification` is **always linked** (it sits behind the `tauri` feature which is the default). Treat any rename or removal as a breaking change.
- Server state type is `Arc<PgPool>`, not bare `PgPool`. Do not deref-then-mutate across `.await`.
- Tauri 2 plugin API for notifications: `app.notification().builder().title("").body("").show()` returns `Result<(), tauri_plugin_notification::Error>`. Use the `NotificationExt` trait.
