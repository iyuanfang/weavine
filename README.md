# Weavine

> **Offline-first · Local data · Multi-device sync** — a small personal relationship manager.

Weavine is a desktop (and Android) app for keeping track of people you actually care about — clients, collaborators, friends, mentors. Data lives in a single SQLite file on your machine; an optional companion server lets multiple devices stay in sync.

It is **not** a Salesforce replacement. It is intentionally small. See [Design philosophy](#design-philosophy) below.

- **GitHub**: https://github.com/iyuanfang/weavine
- **Latest release**: [v0.2.23](https://github.com/iyuanfang/weavine/releases/tag/v0.2.23) — desktop (macOS / Windows / Linux) + Android (signed APK) + Web at [weavine.financialagent.cc](https://weavine.financialagent.cc/)
- **License**: [AGPL-3.0](LICENSE)

---

## What it does

- **Contacts** — name, organization, tags, notes, custom fields.
- **Projects** — group people into ongoing efforts; track who's involved, what's the next step.
- **Calendar & reminders** — schedule catch-ups, set follow-up reminders, see what's on today.
- **Tags & search** — slice your network any way you like; full-text search across everything.
- **Stats** — a small dashboard so you can see at a glance: who you haven't talked to in 60 days, how many new contacts this month, tag distribution.
- **Multi-device sync** — optional. Install the small server, point your devices at it, and your data follows you. No account required of any third party.

That's roughly the whole feature surface. If you need marketing automation, deal pipelines, or email sequencing, use something else.

## Design philosophy

1. **Offline-first.** The app must work fully without network. Sync is a *convenience*, never a *prerequisite*. The local SQLite file is the source of truth; the server only stores what you push to it.
2. **Local data ownership.** Your contacts, projects, and notes live in `weavine.db` on disk. You can `cp` it, `rsync` it, mount it in a Docker volume, or back it up to a USB stick. No vendor lock-in, no API rate limits, no "your account has been suspended".
3. **Simplicity over features.** A smaller, well-designed app beats a feature-rich mess. When in doubt, cut the feature. A view that exists only because some competitor has it is the wrong view.
4. **Audit-friendly.** Open source (AGPL-3.0) and self-hosted. If you don't trust the binary we publish, you can build it yourself from this repo with two commands.
5. **Predictable conflict resolution.** Sync uses last-write-wins on a per-row `server_revision`. There are no "merge conflicts" blocking your work. If you lose a few keystrokes, you lose them — but you can always re-enter them, and the alternative (interactive merge UIs) is worse.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Desktop (Tauri 2 + WebView)          Android (Tauri 2 + WebView)  │
│  ┌──────────────────────────┐          ┌──────────────────────────┐ │
│  │  apps/web-spa  (React)   │          │  apps/web-spa  (React)  │ │
│  │  ↓ @tauri-apps/api       │          │  ↓ @tauri-apps/api       │ │
│  │  src-tauri  (Rust)       │          │  src-tauri  (Rust)       │ │
│  │  ↓ rusqlite              │          │  ↓ rusqlite              │ │
│  │  weavine.db (SQLite)     │          │  weavine.db (SQLite)     │ │
│  └──────────────────────────┘          └──────────────────────────┘ │
└──────────┬────────────────────────────────────────┬────────────────┘
           │                        HTTP/JSON       │
           └─────────────┬──────────────────────────┘
                         ▼
            ┌────────────────────────────┐
            │  server/  (weavine-server) │
            │  axum + sqlx + PostgreSQL  │
            │  11 triggers → sync log    │
            └────────────────────────────┘
                         ▲
                         │  shared models
            ┌────────────┴───────────┐
            │  weavine_lib::models   │  (same struct, dual derive)
            │  serde + FromRow       │
            └────────────────────────┘
```

**One model, two engines.** `weavine_lib::models` is the only thing shared between desktop and server. The desktop compiles it with `rusqlite` bindings; the server compiles the same structs with `sqlx::FromRow`. No trait abstraction, no `trait Repo` — a deliberate decision until the v0.2 sync schema stabilizes (see `AGENTS.md`).

**Why Tauri, not Electron.** Tauri's WebView binary is ~65 MB total including the Rust core; Electron is 150-300 MB and ships its own Chromium. Weavine on macOS is a 6.9 MB DMG, Windows is 7.9 MB MSI, Linux is 6.9 MB DEB. Memory usage is roughly 1/3 of an equivalent Electron app.

## Sync

Multi-device sync is **optional**. A standalone desktop install works forever with no network calls.

When you do want sync:

1. Run `weavine-server` somewhere (Docker, VPS, your NAS — single binary, single Postgres).
2. Log into the same account on multiple devices.
3. The desktop client pushes/pulls `sync_change_log` rows on a timer.

Mechanics (server-side, PostgreSQL):

- Every domain table has a `server_revision BIGINT` column (default `nextval('server_revision_seq')`) and a `deleted_at TEXT` soft-delete column.
- 11 `AFTER INSERT/UPDATE/DELETE` triggers write one row per change into `sync_change_log` with the new row's JSON payload.
- The client pulls changes since its `last_pulled_revision` and applies them locally.
- **Last-write-wins** on `server_revision`. If two devices edit the same row offline, the higher revision wins; the loser is silently overwritten. See [Design philosophy](#design-philosophy) for why we chose this.

This is deliberately simple. There is no CRDT, no vector clock, no "operational transform". If you need those, the project isn't for you (yet).

## Quick start

### Run the desktop app (development)

```bash
pnpm install
pnpm tauri dev          # Vite + Rust hot reload, opens desktop window
```

First launch creates `weavine.db` in the platform data dir and applies all migrations in `server/migrations/` (idempotent).

### Run the sync server (optional)

```bash
# One-time: create .env from .env.example
cp .env.example .env
$EDITOR .env             # set DATABASE_URL, JWT_SECRET, etc.

# Migrate + run
psql "$DATABASE_URL" -f server/migrations/20260704000001_initial_schema.sql
psql "$DATABASE_URL" -f server/migrations/20260705000001_auth_and_devices.sql
psql "$DATABASE_URL" -f server/migrations/20260705000002_domain_uuid_and_revisions.sql
psql "$DATABASE_URL" -f server/migrations/20260705000003_sync_engine.sql
psql "$DATABASE_URL" -f server/migrations/20260705000004_device_upsert_constraint.sql

cargo run --bin weavine-server --release
```

A `Dockerfile` is provided at `server/Dockerfile` for containerized deployment.

### Build release binaries

```bash
pnpm tauri build                           # current platform (mac/win/linux)
pnpm tauri build --target aarch64-apple-darwin
# Android (requires Android SDK + NDK 26.1):
cargo install tauri-cli --version "^2"
cd src-tauri && cargo tauri android build --apk
```

## Downloads

Pre-built binaries (signed with the project's debug keystore; for production you should rebuild and sign with your own keystore):

| Platform | Format | Size |
| --- | --- | --- |
| macOS (Apple Silicon) | DMG | 6.9 MB |
| Windows (x64) | MSI | 7.9 MB |
| Linux (amd64) | DEB | 6.9 MB |
| Android (universal, 4 ABIs) | APK | 64.6 MB |
| Web (PWA) | [weavine.financialagent.cc](https://weavine.financialagent.cc/) | n/a |

All binaries are attached to [GitHub Releases](https://github.com/iyuanfang/weavine/releases). iOS and web versions are on the roadmap but not yet available.

## Tech stack

| Layer | Tech |
| --- | --- |
| Desktop shell | Tauri 2 (Rust + system WebView) |
| Frontend | React 18 · Vite 5 · TypeScript 5 · Tailwind · `@tanstack/react-query` · `@dnd-kit` · `react-router-dom@6` · `zod` |
| Local DB | SQLite via `rusqlite 0.31` (bundled — no system SQLite required) |
| Sync client | `axum 0.7` (HTTP) · `reqwest 0.12` + `rustls` (TLS) · `jsonwebtoken` + `bcrypt` (auth) |
| Sync server | `axum 0.7` · `sqlx 0.8` (PostgreSQL) · `tokio` |
| Shared models | `weavine_lib` — `#[derive(Serialize, Deserialize, FromRow)]` |
| Migrations | 5 idempotent SQL files in `server/migrations/` (run once on server; `CREATE TABLE IF NOT EXISTS` for local SQLite) |

## Project layout

```
.
├── src-tauri/          # Rust backend + Tauri runtime
│   ├── src/
│   │   ├── business/   # 12 modules: contact, project, event, action, …
│   │   ├── commands/   # Tauri IPC handlers (one per business module)
│   │   ├── handlers/   # axum HTTP handlers (sync client side)
│   │   ├── sync/       # sync client: api, config, keys, translate
│   │   ├── db.rs       # rusqlite connection pool
│   │   ├── migration.rs# SCHEMA_SQL (idempotent, runs on every launch)
│   │   └── models.rs   # shared structs (also re-exported as weavine_lib)
│   ├── Cargo.toml      # weavine crate (lib + staticlib + cdylib)
│   └── tauri.conf.json
│
├── server/             # Sync server (weavine-server binary)
│   ├── src/
│   │   ├── handlers/   # 14 HTTP handlers (one per resource)
│   │   ├── main.rs
│   │   └── auth_keys.rs
│   ├── migrations/     # 5 SQL files, applied in order on first run
│   └── Dockerfile      # postgres + server, single image
│
├── apps/web-spa/       # React 18 + Vite frontend
│   ├── src/
│   │   ├── routes/     # page components, one per URL path
│   │   ├── components/ # reusable UI primitives
│   │   ├── lib/        # API client, tauri command wrappers, hooks
│   │   └── routes-config.tsx  # centralized route registry
│   └── package.json
│
├── docs/
│   ├── marketing/      # press / blog drafts
│   └── mobile-limitations.md
│
├── .github/workflows/  # release.yml (builds desktop + Android + uploads)
├── LICENSE             # AGPL-3.0 (full text)
└── README.md
```

## Development

```bash
# Type-check the frontend
pnpm --dir apps/web-spa run typecheck

# Type-check the Rust crates
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path server/Cargo.toml

# Smoke-test the local schema
cargo run --example smoke --manifest-path src-tauri/Cargo.toml

# Run the dev helper (Linux build, lint, etc.)
./scripts/dev.sh help
```

## Configuration

- **Database path** (per platform):
  - Windows: `%APPDATA%\com.weavine.prm\weavine.db`
  - macOS: `~/Library/Application Support/com.weavine.prm/weavine.db`
  - Linux: `~/.local/share/com.weavine.prm/weavine.db`
- **Local HTTP port** for the in-app Tauri webview bridge: default `3299` (overridable in `src-tauri/tauri.conf.json`).
- **Sync server**: copy `.env.example` to `.env`, set `DATABASE_URL`, `JWT_SECRET`, `BIND_ADDR`.

## Roadmap

Near-term:

- **iOS** — Tauri 2 has experimental iOS support; aiming for v0.3.
- **Relationship graph** — visual graph view of contacts ↔ projects ↔ tags, click to navigate.
- **AI-assisted entry** — paste a paragraph of meeting notes, get a draft contact + suggested tags. Local model preferred; cloud model as fallback.

Longer-term:

- **Health score** — per-contact "engagement health" based on cadence, last interaction, and explicit priority.
- **Team / shared workspaces** — multi-user editing of the *same* contact (currently each user has their own copy of a contact synced to the server).

## Contributing

Bug reports, PRs, and design discussions are welcome. The sync schema is still moving in v0.2.x — please open an issue before sending large refactors, so we can agree on the direction.

Code conventions:

- Rust: `cargo fmt`, `cargo clippy -- -D warnings`. No `unwrap()` outside of tests.
- TypeScript: `tsc --noEmit` must pass. No `any` except for third-party untyped shims.
- Migrations: append-only, never edit a merged migration file. Add a new `2026MMDDHHMMSS_description.sql`.

## License

[AGPL-3.0](LICENSE). The full text is in the `LICENSE` file at the repo root. The TL;DR:

- You can use, modify, and distribute this software freely.
- If you run a modified version as a network service, you **must** publish your modifications under AGPL-3.0 as well.
- This is intentional. We don't want a hosted SaaS to fork Weavine and not give back.

If AGPL is a problem for your use case, please open an issue — a separate commercial license is *not* on the table right now, but the discussion is always open.

## See also

- [`AGENTS.md`](AGENTS.md) — repo-wide guidelines for AI agents and contributors.
- [`docs/mobile-limitations.md`](docs/mobile-limitations.md) — what works and what doesn't on Android / iOS.
- [Design spec](docs/superpowers/specs/2026-06-14-prm-design.md) — original single-user design.
- [Timeline redesign](docs/superpowers/specs/2026-06-17-prm-timeline-redesign.md) — interaction history UX.

---

*Made with care by people who'd rather own their data.*
