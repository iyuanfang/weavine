# Changelog

All notable changes to Weavine PRM are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.17] - 2026-08-18

### Fixed

- **Windows / Android 头像图片无法加载** — Tauri v2 自定义 URI scheme 各平台 origin 不同：macOS/Linux（WKWebView/webkitgtk）为 `files://localhost/<path>`，而 Windows（WebView2）与 Android（WebView）为 `http://files.localhost/<path>`。`tauri.ts` 新增 `filesBaseUrl()` 按 `navigator.userAgent` 平台判断返回正确 baseUrl，修复两端头像/媒体图加载。
- **Android 录音/拍照权限不全** — release.yml Android 构建 patch 步骤从仅 RECORD_AUDIO 改为 for 循环依次补齐 RECORD_AUDIO / MODIFY_AUDIO_SETTINGS / CAMERA（各自检查已存在则跳过），保证 AndroidManifest 权限完整，语音捕获与相机拍照可用。
- **Service Worker 缓存版本升级** — `sw.js` CACHE 从 weavine-v3 升到 weavine-v4，强制客户端丢弃旧缓存获取新前端资源。

## [1.0.16] - 2026-08-18

### Changed

- **头像裁剪改为微信式交互**（Windows / Android / Web 三端同步）— `AvatarCropModal.tsx` 重写：裁剪圆圈固定居中不再可拖动，改为**拖动底图**调整位置、滚轮/双指捏合/滑杆缩放底图（1x–4x）。圆圈尺寸固定（150px 半径），移除三个预览小图，模态与控件宽度统一。与微信头像裁剪一致，手机上单手拖动更顺手。
- **大图查看 modal 显示为圆形** — `AvatarViewModal.tsx`：图片改为 `borderRadius: 50%` + `aspectRatio: 1/1` + `objectFit: cover`（原来是方形大图），与全端圆形头像显示一致。

### Fixed

- **点击"更换头像"同时弹出大图查看 modal** — 隐藏文件选择 input 嵌套在头像 div 内，`fileInput.click()` 冒泡触发父级 `onClick` 打开 `AvatarViewModal`。修复：input 加 `onClick` 阻止冒泡（`ContactDetail.tsx`）。

## [1.0.8] - 2026-08-16

### Fixed

- **OCR 405 Method Not Allowed on Windows v1.0.7** —
  `src-tauri/src/commands/ocr.rs::extract_card` was POSTing to
  the bare `server_url` (e.g. `https://weavine.financialagent.cc`)
  instead of `https://weavine.financialagent.cc/api/cards/extract`.
  nginx's default root route only accepts GET, so the multipart
  POST was rejected with `405 Method Not Allowed` and the OCR
  call surfaced as
  `ocr failed (405): <html>nginx/1.28.2`. The fix routes through
  `format!("{}/api/cards/extract", server_url.trim_end_matches('/'))`
  — same pattern `recognize_voice` and `save_card_image` already
  use. Verified locally with `cargo check -p weavine` (clean,
  only pre-existing warnings).

### Changed

- **Removed `使用云端语音` toggle on Windows desktop Tauri** —
  `apps/web-spa/src/components/QuickCapture.tsx` no longer shows
  the cloud-voice checkbox. Windows Tauri now always uses the
  Edge WebView2 native `webkitSpeechRecognition` (Microsoft STT,
  free, offline-capable). Only Android Tauri continues to use
  cloud whisper (forced — `isAndroidTauri()` returns true there
  and the Android WebView's webkitSpeechRecognition is
  broken-by-design per `apps/web-spa/src/lib/voice.ts:28-30`).
  Removed: `USE_CLOUD_VOICE_KEY` localStorage key, `useCloudVoice`
  state, the checkbox row, and `showCloudToggle` conditional.
  Browser standalone mode is unaffected (always used Web Speech
  API).
- **`FREE_DAILY_LIMIT` 20 → 100** — per-install OCR + voice
  quota for the FREE plan is now 100 calls/day. `TRIAL_DAILY_LIMIT`
  stays at 50, `PRO_DAILY_LIMIT` stays at 1,000,000. User JWTs and
  `X-Service-Key` continue to bypass the cap. The quota check
  lives in `server/src/handlers/activation.rs::check_and_bump_quota`
  and is enforced by `extract_card` and `recognize_voice` only
  on the anonymous device-key path.

## [1.0.7] - 2026-08-16

### Added

- **Re-OCR an existing contact from the detail page** — the
  contact detail page (`/contacts/:id`) now has a `📷 重新拍名片`
  button in the top action bar. Clicking it opens a modal that
  reuses the existing `CardScanner` component, runs OCR on a new
  card photo, and shows a per-field confirmation form
  (`RescanCardModal`) listing each parsed field next to its
  current value (`当前：xxx / 新值：yyy`). Default all checked;
  unchecking a row keeps the existing value. On confirm, the
  contact is patched via `PUT /api/contacts/:id` with only the
  picked fields and the new image is uploaded via
  `POST /api/media` with `kind=card_image`. Existing card images
  are kept (the upload adds a new row, never replaces in place),
  so the previous scan stays in the history.
  - Server is unchanged: `PUT /api/contacts/:id` already accepts
    partial updates (`server/src/handlers/contact.rs:203` builds
    the UPDATE clause dynamically from present JSON fields), and
    `POST /api/media` already accepts `kind=card_image` against
    any `owner_id`.

## [1.0.6] - 2026-08-15

### Fixed

- **Windows fresh-install OCR / voice "未连接云端"** — the Tauri
  desktop binary previously read `KEY_SERVER_URL` from the local
  SQLite `config` table only, so a brand-new install with no login
  would fail OCR (`commands/ocr.rs::extract_card`) and voice
  (`commands/voice.rs::recognize_voice`) with `未连接云端` until the
  user logged in via Settings. The web SPA already hard-coded
  `https://weavine.financialagent.cc` as a default; the desktop
  binary now does the same.
  - `sync/config.rs` gained `default_server_url()` (reads
    `option_env!("WV_DEFAULT_SERVER_URL")` for self-host builds,
    falls back to `https://weavine.financialagent.cc`) and
    `effective_server_url(conn)` (stored value or default).
  - `install_id.rs::spawn_first_launch_ping` now uses
    `effective_server_url` so the first-launch activation ping
    still fires on a fresh install.
- **First-launch `device_key` 5 s race** — the previous
  `spawn_first_launch_ping` waited 5 s before POSTing
  `/api/activation/ping`. Any OCR / voice call inside that window
  sent a client-minted `X-Device-Key` the server didn't recognize,
  and the server rejected it with `401 anonymous device not
  registered`. The desktop commands now call a new
  `install_id::ensure_device_key_registered(server_url)` on the
  anonymous path, which posts to `/api/activation/ping`
  synchronously and persists the server-issued `device_key` to
  `<data_dir>/device_key` before continuing. Subsequent calls in
  the same session reuse the persisted key.

## [1.0.5] - 2026-08-15

### Changed

- **Per-install OCR/voice quota enforcement** — `install_activation`
  gained `daily_ocr_count`, `daily_voice_count`, and `daily_reset_at`
  columns. Anonymous-device-key calls (`POST /api/cards/extract`,
  `POST /api/voice/recognize`) now check the quota and return
  `429 daily ocr quota exceeded (count/limit)` once the per-day
  cap is hit. User JWTs and `X-Service-Key` (dev/CI) bypass the cap.
  Limits: FREE=20/day, TRIAL=50/day, PRO=1,000,000/day. Reset window
  is a rolling 24 h after `daily_reset_at`. Auto-creates the
  columns on first call so old activation rows from v1.0.3 still
  work.
- **Drop default `chi_tra` from OCR language set** — `tess_langs()`
  default changed from `chi_sim+chi_tra+eng` to `chi_sim+eng`.
  `chi_tra.traineddata` (57 MB) removed from
  `/usr/share/tesseract/tessdata` on prod. Operators can still
  load it via `TESS_LANGS=chi_sim+chi_tra+eng` if they need it.
- **Monotonic merge for `reminder.dispatched` and `dismissed`** —
  server-side `POST /api/sync/push` rewrite the `ON CONFLICT` clause
  for the reminder table so dispatched/dismissed state is merged
  with `OR` instead of last-writer-wins. Once a reminder fires on
  any device, it stays fired on every device; once it is dismissed,
  it stays dismissed. All other reminder columns still use plain
  `EXCLUDED.col`.
- **Per-ABI APK splits — 80 MB → ~20 MB** — Android build now emits
  three APKs (arm64-v8a / armeabi-v7a / x86_64) instead of one
  universal APK. The Rust toolchain target list in `release.yml` is
  trimmed from 4 to 3 ABIs; the staging script signs all per-ABI
  APKs and names them `Weavine_<abi>-release.apk`. Universal APK
  is dropped (x86 already excluded since no real Android devices
  ship that ABI). CI injects `splits { abi { ... } }` into
  `build.gradle.kts` after the stable `buildFeatures { ... }` anchor
  on every run; the patch is idempotent.
  - arm64-v8a (most physical Android devices): ~22 MB
  - armeabi-v7a (32-bit budget devices): ~17 MB
  - x86_64 (emulator / Chromebook): ~21 MB

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

## [1.0.15] - 2026-08-17

### Fixed

- **Android v1.0.14 安装即闪退** — v1.0.14 新增的 `MainActivity.kt` Kotlin 补丁试图用 `setWebViewClient` + `setWebChromeClient` 拦截 `onShowFileChooser`，但 wry 0.55.1 在 `android_setup` 阶段（`main_pipe.rs:288`）已经用自身的 `RustWebChromeClient` 注册了 chrome client；后注册的回调被覆盖。同时 wry 在 `WryActivity.onCreate` 之外二次创建 `RustWebChromeClient` 会触发 `registerForActivityResult` → `IllegalStateException: LifecycleOwners must call register before they are STARTED`（wry `mod.rs:134` 注释明确警告）。结果：v1.0.14 APK 启动时 100% 闪退。v1.0.15 完全移除 Kotlin 补丁，回退到 wry 默认行为；OEM 麦克风权限修复需要 fork wry 源码，超出当前范围，临时搁置。
- 同步清理：删除 `src-tauri/android-patch/` 整个目录；删除 `release.yml` 中 `cp MainActivity.kt` 步骤，替换为 `Verify default MainActivity is in place`（仅校验 wry 默认产物存在）。`release.yml` 的 `frontendDist` 与 `RECORD_AUDIO` 两个 sed 注释块保留不动。

## [1.0.14] - 2026-08-17

### ⚠️ 此版本 Android 安装即闪退，请跳过 — 使用 v1.0.15。

### Fixed

- **Android 头像保存 "no data dir"** (`0d62983`) — `commands/media.rs::data_dir()` 调 `dirs::data_dir()`，Android 上 Tauri 未设置 `XDG_DATA_HOME`，返回 `None`。改为 `lib.rs::dirs_data_dir_fallback` 同样的回退（`<cwd>/com.weavine.desktop`）。
- **Android 麦克风权限没有系统对话框** (`0d62983`) — `WebChromeClient` 在 wry 创建时被覆盖，权限请求进不到 OEM 默认路径。引入 `MainActivity.kt` Kotlin 补丁 + `release.yml` 拷贝步骤 — **但补丁与 wry 0.55.1 的 `RustWebChromeClient` 初始化时序冲突（见 v1.0.15）**，因此该 fix 在用户设备上失败；正式修复在 v1.0.15。

## [1.0.13] - 2026-08-17

### Fixed

- **Windows 编辑联系人 → 重新 OCR → 确认更新 报错"未连接云端"** — `commands/ocr.rs::save_card_image` 走 `load_credentials()`（需要 `KEY_SERVER_URL` + `KEY_ACCESS_TOKEN` 同时存在），但匿名 device_key 路径缺失，与 `extract_card` 的 fallback 链不对齐。改为统一鉴权链：user_token → service_key → device_key，与 `extract_card` 行为一致。
- **Windows 头像更换 不报错但头像没变** — `lib/avatarUrl.ts` 改为 `avatarUrlFor(key)` 生成 `<src>?v=<hash>` cache buster；storage_key 每次上传本就不同（`{sha16}-{uuid}.ext`），因此这是 belt-and-suspenders，主要防御 CDN/proxy 缓存命中。
- **Android "无法访问麦克风；请在系统设置中授予应用麦克风权限" — 没有系统权限对话框** — `cargo tauri android init` 在 CI 每次重新生成 `AndroidManifest.xml`，v1.0.12 的 `RECORD_AUDIO` 编辑被清掉。改用 `release.yml` 注入 `sed` 步骤（与现有 `build.gradle.kts` 补丁同样的模式）。
- **Android 更换头像 最后报错 "no data dir"** — 同 v1.0.14 root cause，`commands/media.rs` 加 Android fallback。
