# Changelog

All notable changes to Weavine PRM are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.7] - 2026-07-04

### Added

- **Auto-archive 归档** — completed 待办 (>1 day), past 日程 (>end_at or start_at if no end), and terminal-stage 项目 (>7 days after terminal update) automatically move to the archive. Initial sweep runs on server startup; rules live at `/archive`.
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
