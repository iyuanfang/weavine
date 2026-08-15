# Changelog

All notable changes to Weavine PRM are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2026-08-15

### Changed

- **Reminder scheduling moved to Rust** — the JS 30 s polling loop
  (`use-reminder-poller.ts`) is gone in Tauri builds. `create_event`,
  `update_event`, `create_reminder`, and `update_reminder` now call
  `commands::notification::schedule_for_reminder()` after writing the
  row, which spawns a Tokio sleep task and fires the OS notification
  through `tauri-plugin-notification` at `trigger_at`. CPU is idle
  between triggers; no more wake-every-30-seconds.
  - `claim_due_reminders()` runs at wake time to mark the row
    `dispatched = 1` so the next startup catch-up does not duplicate.
  - `startup_catch_up()` (called from `lib.rs::setup()`) reschedules
    every pending reminder that was lost when the OS killed the app
    between sleeps.
  - Rust emits `weavine:reminder-fired` after each fire so the JS
    in-app banner (CustomEvent `weavine:reminder`) still triggers
    when the webview is foregrounded.
- `use-reminder-poller.ts` now branches on `isTauri()`: Tauri builds
  listen to the Rust event; browser standalone keeps the legacy
  polling + Web Notification API path (Rust runtime not available).

## [1.0.3] - 2026-08-15

### Added

- **Per-install `device_key`** — replaces the shared `WV_SERVICE_KEY` model
  for the anonymous OCR/voice path. Each install gets a unique 32-char
  hex key minted by the server on the first `POST /api/activation/ping`
  and persisted to `<data_dir>/device_key` (Tauri) or
  `localStorage[weavine:device_key]` (web). The client sends it on
  every cloud call as `X-Device-Key`. The server validates it against
  `install_activation.device_key` (CREATE UNIQUE INDEX partial on
  `WHERE device_key IS NOT NULL`).
  - Forward-looking columns also added to `install_activation`:
    `plan`, `daily_ocr_count`, `daily_voice_count`, `daily_reset_at`,
    `revoked_at`. No code uses them yet but adding them now saves a
    1.0.4 migration.
  - New server helper `extract_endpoint_auth()` returns
    `EndpointAuth::AnonymousDevice { install_id }` /
    `EndpointAuth::User { user_id, device_id }` /
    `EndpointAuth::ServiceKey`. Order: `X-Device-Key` → JWT/API key →
    `X-Service-Key`. Shared `WV_SERVICE_KEY` is kept as a dev/CI override
    so unit tests and e2e scripts keep working without per-install setup.
  - Tauri: `install_id::get_or_create_device_key()` reads
    `<data_dir>/device_key`, mints a fresh UUID v4 hex if missing.
    `spawn_first_launch_ping()` now awaits the response and persists
    the server-minted key. `commands/ocr.rs` and `commands/voice.rs`
    add `X-Device-Key` to the request.
  - Web SPA: `lib/install-id.ts` adds `getDeviceKey()` /
    `saveDeviceKey()` (localStorage), `installHeaders()` adds
    `X-Device-Key` when present, `fireFirstLaunchPing()` writes
    the response's `device_key` into localStorage.
  - README "Activation tracking" section updated to describe the new
    `X-Device-Key` flow and the migration path.

- **Activation tracking** — every Tauri / web install registers itself with
  `weavine-server` so anonymous users (the people who never log in) become
  visible in the product's usage stats. The same UUID becomes the
  `device_id` after login, so a JOIN between `install_activation` and
  `devices` reveals multi-device users.
  - Server: new table `install_activation` (migration
    `20260814000001_install_activation.sql`) + `POST /api/activation/ping`
    handler + `record_activation_hook` called from `handlers/ocr.rs` and
    `handlers/voice.rs` after auth. IP stored as `SHA-256(JWT_SECRET || ip)`
    only — raw IP is never persisted.
  - Tauri: `install_id::get_or_create()` mints a UUID v4 on first launch
    and stores it in `<data_dir>/install_id`; `setup()` spawns a 5 s delayed
    `POST /api/activation/ping` so even pure-local users are counted.
  - Web SPA: `lib/install-id.ts` mirrors the Tauri logic against
    `localStorage[weavine:install_id]`; `fireFirstLaunchPing()` fires once
    after first render, idempotent.
  - Auth: `register()` and `login()` now use `device.install_id` as the
    `devices.id` PK when present, falling back to a fresh UUID v4 for older
    clients. Validates install_id (≤ 64 chars, `[A-Za-z0-9-]` only).
  - 10 ready-to-use SQL queries in `docs/activation.sql` (DAU/MAU,
    platform breakdown, multi-device funnel, anon → logged-in cohort).

### Fixed

- `INSERT ... ON CONFLICT ... RETURNING` clause no longer references
  `EXCLUDED` (which is only valid in the `SET` clause). Caught by the
  prod smoke test — the table itself was the new assembly, only the
  `POST /api/activation/ping` SQL was wrong.

## [1.0.2] - 2026-08-14

### Added

- **Zero-login cloud OCR & STT** — the Tauri client can call the sync server
  for business-card OCR and voice transcription without the user logging in.
  Useful on platforms where local STT is broken (e.g. Android WebView) and as
  a free, CPU-only alternative to paid APIs.
  - Server: `handlers/voice.rs` (NEW, whisper.cpp `tiny` + symphonia + rubato,
    ffmpeg subprocess fallback for unsupported containers), `handlers/auth.rs`
    extended with `X-Service-Key` / `Bearer` service-key auth (constant-time
    compare, no `user_account` row involved), `handlers/ocr.rs` accepts the
    service key on `/api/cards/extract`.
  - Vendored `whisper-rs-sys` 0.14.0 under `server/vendor/` with a workspace
    `[patch.crates-io]` so the upstream bindgen step is skipped — the build
    only needs the bundled `bindings.rs`.
  - Tauri: `commands/voice.rs` (NEW `recognize_voice` command) plus a
    user-key → runtime-config → `option_env!("WV_SERVICE_KEY")` → empty
    fallback chain in `commands/ocr.rs` so a build without the env var still
    works (degrades to "未登录云端" rather than failing).
  - Desktop `QuickCapture` got a cloud-voice checkbox (localStorage
    `weavine:voice:useCloud`); Android FAB now uses the cloud path by default.
  - New docs: `scripts/install-whisper-model.sh`, `server/.env.example`
    (all 14 env vars documented), README "Cloud OCR & STT (optional)" section
    with privacy disclosure, `scripts/deploy-server.sh` now installs ffmpeg,
    leptonica-devel, tesseract-devel + langpacks and builds with
    `--features ocr,stt`.

### Fixed

- **Quick-capture contact linking** — when a quick-capture sentence mentioned
  a contact's name, the parser used to set `search = Some("张三 李四")` so the
  `LIKE '%张三 李四%'` filter never matched the single token and `contact_id`
  stayed `NULL`. Switched to `search = None` (the parser already returns the
  matched `contact_ids`); two regression tests added
  (`commands::quick::tests`), both pass.

## [1.0.1] - 2026-08-13

### Changed

- **Contact `city` → `address`** across the whole stack. The field now holds
  the full free-form location (street, city, postcode, country) instead of
  just the city. vCard ADR parsing joins the relevant parts with `, ` and
  drops empties; CSV import accepts `地址` / `address` / `addr` aliases.
  - Server: idempotent migration `20260813000001_contact_address_rename.sql`
    (rename only when `city` exists and `address` doesn't). Handlers,
    `ContactWithRole`, and `INSERT`/`UPDATE` whitelists updated.
  - Desktop: `Contact`, `CreateContactInput`, `UpdateContactInput`,
    `business::contact` (row_to_contact / INSERT / UPDATE),
    `migration.rs` SCHEMA_SQL + index rename guard, `sync::translate` push
    columns, sync schema/test data, and three test fixtures.
  - MCP: `CreateContactBody` / `UpdateContactFields` with new schemars
    description.
  - Web: types, ContactNew/Edit state and label, ContactDetail info fields,
    ContactsList CSV import map, Settings, parseContacts.

### Added

- **Card image persistence** — after OCR + 创建联系人, the original card photo
  is uploaded as `kind=card_image` media attached to the new contact.
  Desktop exposes a new `save_card_image` tauri command that POSTs the image
  to `/api/media`. Contact detail page renders a 名片 thumbnail; click
  opens a full-size viewer (`CardImageViewModal`).
- **Android camera on tap** — `<input type="file" capture="environment">`
  on the card scanner, so Android opens the rear camera directly instead
  of forcing the user to shoot then pick from the gallery.
- **Modal CSS** — `.modal-backdrop`, `.modal`, `.button-primary`,
  `.button-secondary`. The avatar crop modal had been rendering but was
  invisible because these classes were never defined; uploading now works.

### Improved

- **AvatarCropModal rewritten** — CSS mask circular crop (no separate ring
  div), 4-channel zoom (wheel / pinch / slider / +/- buttons), reset button,
  live preview thumbnails at 88 / 40 / 32 px (so the user sees what each
  surface actually looks like), wider modal (580px, maxWidth 92vw) so the
  stage and preview column sit side by side. Single 保存头像 button. PNG
  fallback when webp encoding returns null.
- **Contact list avatar** — single `<Avatar>` component per row instead of
  a 40×40 wrapper around a 32×32 Avatar, so the initial colour ring is
  gone.

### Internal

- Server: `axum::middleware::from_fn(log_requests)` wraps every route so
  401'd requests are visible in logs; `media.rs` and `storage.rs` add
  structured request/field/DB trace lines that stay in for future upload
  bisecting.

## [0.1.8] - 2026-07-04

### Fixed

- **Event archive threshold 0d → 1d** — today's meeting at 02:00 no longer disappears instantly; sweep waits until `now > end_at + 1 day`. Stopped: "日程早上结束就直接被归档", which broke the day's UX.
- **Archive sweep missing on Tauri desktop** — only `web_server` binary called `sweep_archives` at startup; opening the bundled Tauri app never ran the sweep. The startup sweep is now invoked from `lib.rs::run()` as well, so both `weavine` and `weavine-web` binaries archive on launch.

## [0.1.7] - 2026-07-04

### Added

- **Auto-archive 归档** — completed 待办 (>1 day), past 日程 (>end_at + 1 day, or start_at + 1 day if no end), and terminal-stage 项目 (>7 days after terminal update) automatically move to the archive. Initial sweep runs on server startup; rules live at `/archive`.
- **Archive page** (`/archive`) — single canonical view for all archived items across actions, events, and projects. Per-row unarchive and per-section [全部恢复] (last 30 days) controls.
- **Sidebar 归档 link** + first-launch onboarding banner (dismissible via localStorage `archive-tip-dismissed`).
- **Settings → Archive** section listing live counts, auto-archive rules, and bulk recover.
- **Search** now defaults to include-archived, with a [包含已归档项] checkbox toggle and 📦 badge prefix on archived hits. Returns contacts / events / actions / projects.
- **Event end_at defaults to start_at + 1h** on the new-event form; promoted to a `required` field so no event is created without a duration.
- **macOS release workflow** — `.github/workflows/release.yml` now ships `.app` (universal) and `.dmg` alongside Windows MSI and Linux deb/AppImage.

### Changed

- All list endpoints (`/api/actions`, `/api/events`, `/api/projects`) accept an `archived` query parameter: `true` (only archived), `false` (only active — default), `all` (both).
- All list handlers in the frontend pass `archived: 'false'` for normal lists; cross-references (Project, Contact detail) also exclude archived items.
- Sidebar order: 待办 now precedes 日程 (left-side grouping).

### Internal

- New tables columns `archivedAt` on `Action`, `Event`, `"Project"` with matching indexes (idempotent migration).
- New module `business/archive_sweep.rs` + `handlers/archive.rs` + `/api/archive/{summary,counts,list,unarchive-one,bulk-unarchive}` endpoints.
- Tauri `search` command signature extended with `include_archived: Option<bool>` (default `true`).
