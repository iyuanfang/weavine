# Changelog

All notable changes to Weavine PRM are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
