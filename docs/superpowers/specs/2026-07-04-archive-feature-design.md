# Archive (归档) — Product Design v2 (auto-only)

**Date:** 2026-07-04 (updated from v1, same day)
**Status:** Design only — awaiting implementation approval
**Author:** Iterative design discussion with user (transcribed by Sisyphus)

## 1. Change from v1

v1 had manual archive/unarchive buttons and per-page "显示已归档" toggles. The user revised toward a simpler model: **fully automatic archiving with a single bulk recovery utility, no per-item buttons**.

> 待办 完成 多久，日程 结束多久，项目 完成多久 自动归档。也不需要手动改。

This document supersedes v1. Schema change is the same; UI surface is dramatically simpler.

## 2. Design Decisions

### 2.1 Auto-archive — fully automatic, no per-item buttons

| Decision | Choice | Why |
|---|---|---|
| Archive trigger | App startup sweep (lazy, O(n), milliseconds) | No background threads, no timers |
| Per-entity thresholds | 待办 1 day / 日程 0 days / 项目 7 days | Aggressive; lists stay clean |
| Manual archive button | **None** | User wanted simplicity |
| Manual unarchive button | **None** (only bulk) | Forces recovery to be deliberate |
| Filter panel "显示已归档" toggle | **None** | Archived = out of list views |
| Contact page archived footer | **None** | Cleaner contact page |

### 2.2 What "终态" means for projects

A project is archive-eligible when its current stage is the **terminal stage** of its template.

| Template | Terminal stage(s) |
|---|---|
| general | 已完成 |
| sales | 中标 (won) AND 丢单 (lost) — both terminal |
| event_prep | 已收尾 |

**丢单 projects auto-archive** — terminal by design. After 7 days of no activity, they disappear from lists; search still finds them.

Non-terminal-stage projects (e.g., 线索 / 沟通 / 报价) never auto-archive regardless of activity.

### 2.3 Recovery: global search + settings bulk unarchive

Two recovery paths, neither per-item:

1. **Global search `/search`** — always searches both active and archived. Archived results show with a 📦 badge. Primary recovery path; user must remember or search by hint.

2. **Settings 批量 unarchive utility** — on every app start, count items archived in the last 30 days, offer bulk unarchive:

   ```
   数据整理
     待办 — 最近 30 天归档 23 项     [取消归档]
     日程 — 最近 30 天归档 5 项      [取消归档]
     项目 — 最近 30 天归档 12 项     [取消归档]
   ```

   The only place unarchive happens. Deliberate cost prevents archive/unarchive churn.

### 2.4 Delete remains separate and explicit

Permanent delete is unchanged: red button on detail pages with double-confirmation modal. Archived-or-not, same rule.

## 3. Schema (unchanged from v1)

```sql
ALTER TABLE Action  ADD COLUMN archivedAt TEXT;
ALTER TABLE Event   ADD COLUMN archivedAt TEXT;
ALTER TABLE Project ADD COLUMN archivedAt TEXT;

CREATE INDEX idx_action_archivedAt   ON Action(archivedAt);
CREATE INDEX idx_event_archivedAt    ON Event(archivedAt);
CREATE INDEX idx_project_archivedAt  ON Project(archivedAt);
```

`archivedAt` nullable: NULL = active, non-NULL = archived timestamp.

## 4. Auto-Archive Rules

| Entity | Condition | Threshold | Effect |
|---|---|---|---|
| Action | `status='done'` AND `completedAt` < now − 1 day | 1 day | set `archivedAt = now` |
| Event | `ends_at` < now (use `starts_at` fallback when no ends_at) | 0 days (end-of-event-day) | set `archivedAt = now` |
| Project | current stage is terminal AND `updated_at` < now − 7 days | 7 days | set `archivedAt = now` |

### 4.1 Edge cases

- **Event without ends_at**: archive when `starts_at < now`.
- **Project with `completedAt` NULL but terminal stage**: trigger via `updated_at` recency as proxy for "stage has been terminal for X days".
- **Just-completed item**: never archived instantly; waits full threshold.
- **Cross-midnight events**: sweep uses `ends_at < now` (not calendar-day math) — handles events spanning midnight cleanly.

### 4.2 Sweep implementation

Single Rust function, called once on app startup:

```rust
pub fn sweep_archives(conn: &Connection, now: DateTime<Utc>) -> Result<usize> {
    let now_iso = now.to_rfc3339();

    let n_actions = conn.execute(
        "UPDATE Action SET archivedAt = ?1 \
         WHERE archivedAt IS NULL \
           AND status = 'done' \
           AND completedAt IS NOT NULL \
           AND datetime(completedAt) < datetime(?1, '-1 day')",
        params![now_iso],
    )?;

    let n_events = conn.execute(
        "UPDATE Event SET archivedAt = ?1 \
         WHERE archivedAt IS NULL \
           AND datetime(COALESCE(ends_at, starts_at)) < datetime(?1)",
        params![now_iso],
    )?;

    let terminal_stages = terminal_stages_for_all_templates();
    let placeholders = vec!["?"; terminal_stages.len()].join(",");
    let sql = format!(
        "UPDATE Project SET archivedAt = ?1 \
         WHERE archivedAt IS NULL \
           AND stage IN ({placeholders}) \
           AND datetime(updated_at) < datetime(?1, '-7 day')",
        placeholders = placeholders,
    );
    let mut params_vec: Vec<&dyn ToSql> = vec![&now_iso];
    for s in &terminal_stages { params_vec.push(s); }
    let n_projects = conn.execute(&sql, params_vec.as_slice())?;

    Ok(n_actions + n_events + n_projects)
}
```

`terminal_stages_for_all_templates()` returns the union of all terminal stages across all templates (e.g., `["已完成", "中标", "丢单", "已收尾"]`). Adding a template later just requires updating this lookup.

## 5. API Surface

Same PUT for archive / unarchive (used by settings bulk utility), plus a small settings-specific endpoint:

```
GET  /api/actions?archived=false          # default, only active
GET  /api/actions?archived=true           # only archived
GET  /api/actions?archived=all            # everything (used by global search)

PUT  /api/actions/:id  { archived_at: <iso> | null }
PUT  /api/events/:id   { archived_at: <iso> | null }
PUT  /api/projects/:id { archived_at: <iso> | null }

GET  /api/settings/archive-summary          # counts archived in last 30 days per type
POST /api/settings/bulk-unarchive           # { entity: 'action'|'event'|'project' }
```

`bulk-unarchive` clears `archived_at = NULL` where `archived_at >= now − 30 days`. Older items remain archived.

## 6. UI Behavior

### 6.1 What changes vs current state

| Surface | v2 behavior |
|---|---|
| 待办 list | nothing else — archived items disappear from results. **Bottom of filter panel** gains an "📦 已归档 N 项 [查看]" link to `/archive`. |
| 日程 list | nothing else — past events stop appearing. **Bottom of filter panel** gains an "📦 已归档 N 项 [查看]" link to `/archive`. |
| 项目 list | nothing else — terminal-stage projects disappear after 7 days. **Bottom of filter panel** gains an "📦 已归档 N 项 [查看]" link to `/archive`. |
| `/archive` route | New dedicated page. Three tables (待办 / 日程 / 项目), sorted by archived_at DESC, with per-row [取消归档] button + [全部取消归档] per section. The only place per-item cancel-archive buttons exist. |
| Filter panels | no "显示已归档" toggle (archived still hidden by default) — but each list page's filter-panel bottom gets the "📦 已归档 N 项 [查看]" link |
| Detail pages | no 归档 / 取消归档 button. Permanent delete still exists. |
| Contact page cross-references | no archived footer section (recover via /archive or search) |
| Multi-select / batch | no archive / unarchive actions |
| Today page | archived items never appear |
| Calendar view | archived items never appear |
| Global search `/search` | searches everything by default; archived results show 📦 badge |
| `/settings` | gains "数据整理" section with bulk-unarchive utility |

### 6.2 Filter-panel entry (each list page)

In each list page's left filter panel (待办 / 日程 / 项目), at the bottom (after all existing filter sections), add a single quiet link:

```
─── (separator) ───
📦 已归档 23 项        [查看 →]
```

Styling: muted text, slightly smaller font. Only shown when count > 0. Clicking takes user to `/archive` (auto-scrolled to the relevant section).

### 6.3 `/archive` route — dedicated archive view

Single page, three sections, each one a sortable table sorted by `archived_at DESC`:

```
📦 归档                                    [全部取消归档当前 30 天]

待办 (23)
  ┌──────────────┬─────────────────┬─────────────┬─────────────┬─────────────┐
  │ 归档时间      │ 标题            │ 完成于       │ 关联项目     │             │
  ├──────────────┼─────────────────┼─────────────┼─────────────┼─────────────┤
  │ 今天 09:14   │ 发邮件          │ 7/2         │ E2E v2      │ [取消归档]  │
  │ 今天 09:14   │ 跟进 决策人      │ 7/2         │ v0.1.5 e2e  │ [取消归档]  │
  └──────────────┴─────────────────┴─────────────┴─────────────┴─────────────┘

日程 (5)
  ... same shape: archived_at / title / when / location / [取消归档]

项目 (12)
  ... same shape: archived_at / title / stage / template / [取消归档]
```

This is **the only place** per-item [取消归档] button lives. Justification: user has intentionally navigated to the archive view; 1-click recovery is appropriate here. Everywhere else (lists, details) the rule "no per-item buttons" still holds.

顶部 `[全部取消归档当前 30 天]` 按钮触发的就是 settings 那个 bulk 操作——给非 settings 页一个等价入口。

### 6.4 Unarchive semantics — pure visibility flip, no transformation

When an item is unarchived (per-item or bulk):

- `archived_at = NULL` only
- All other fields unchanged (status, dates, relations, content)
- **待办**: if `status='done'`, stays done. User must edit to reopen.
- **日程**: stays in past (won't appear in upcoming). User must edit dates.
- **项目**: stays at terminal stage. User must move stage to reopen.

No implicit status / stage transformation. User decides what to do with the recovered item.

### 6.5 Settings page — only UI for archive management

```
数据整理

自动归档规则
  待办 完成后 1 天 自动归档
  日程 结束后（次日） 自动归档
  项目 进入终态阶段后 7 天 自动归档
  销售管线的「丢单」也算终态
  上述规则每次启动自动执行

批量恢复（最近 30 天内自动归档的）
  待办 23 项        [取消归档]
  日程 5 项         [取消归档]
  项目 12 项        [取消归档]
```

### 6.6 Onboarding hint (first time)

When user first opens the app after this feature ships:

> 完成后 1 天自动归档，不在列表显示。需要找回就用搜索（⌘K），或在「设置 → 数据整理」批量恢复。

Dismissible per user, doesn't repeat.

## 7. What users lose vs v1

| Feature in v1 | In v2? |
|---|---|
| Per-item 归档 button | No (auto only) |
| Per-item 取消归档 button | No (bulk only) |
| Per-list "显示已归档" toggle | No |
| Contact page archived footer | No |
| Filter "归档" on list pages | No |

**Trade-off accepted**: if a user wants to look at one archived item, they must (a) remember or search for it, or (b) bulk-unarchive everything archived in the last 30 days.

Justified by simpler mental model: nothing to manually archive, nothing to remember to unarchive. Items live their lifecycle and disappear quietly; search finds them.

## 8. Acceptance Criteria

A release is shippable when all of the following hold:

- [ ] DB migration adds `archivedAt` cleanly to all 3 tables; new column nullable
- [ ] All existing PUT requests still work; new `archived_at` field round-trips
- [ ] On app startup, archive sweep runs:
  - Action `status='done'` AND `completedAt < now-1d` → archived
  - Event `ends_at < now` (or `starts_at` fallback) → archived
  - Project terminal stage AND `updated_at < now-7d` → archived
- [ ] Lists (待办 / 日程 / 项目) show only active items; no UI toggle
- [ ] Detail pages have no archive / unarchive button; permanent delete remains
- [ ] Contact page cross-reference lists show only active items
- [ ] Today page and calendar view never show archived items (manually verified)
- [ ] Global `/search` includes archived by default; 📦 badge on archived rows
- [ ] Settings page shows archive summary counts on every app start
- [ ] Settings bulk-unarchive works for each entity type; clears `archived_at` for items archived in last 30 days
- [ ] First-launch onboarding banner shown once, dismissible
- [ ] No existing user workflow breaks: existing data stays NULL = active
- [ ] Sweep completes in < 50ms even with 10k rows

## 9. Decisions Log

| Decision | Choice | Rejected alternative |
|---|---|---|
| Manual archive buttons | No — auto only | v1: per-item archive/unarchive |
| Per-list "显示已归档" toggle | No | v1: user toggle |
| Contact page archived footer | No | v1: collapsible footer |
| Multi-select batch archive | No | v1: batch operations |
| Cascade on archive | No | (same as v1) |
| Time-based auto-archive | **Yes**, every startup | v1: no auto |
| Sweep trigger | App startup only | Background thread, timer |
| Recovery path | Search + `/archive` page + bulk unarchive | Per-item unarchive on lists/details |
| Sales 丢单 | Auto-archive (terminal stage) | Exempt |
| Project archive trigger | Terminal stage + `updated_at < now-7d` | Need explicit completedAt |
| Version bump | Stay v0.1.x | v0.2.0 |
| Defaults | 待办 1d / 日程 0d / 项目 7d | More aggressive, more lenient |
| Where archived items show | `/archive` page (dedicated), filter-panel link on each list, global search (📦 badge), never on lists/details/today/calendar/contact-page | Per-list toggle |
| Unarchive semantics | Pure visibility flip; status/dates/stage unchanged | Implicit reset to active state |
| Per-item [取消归档] button | Yes on `/archive` only | No buttons anywhere |

## 10. Phased Rollout

| Phase | Scope | Tag |
|---|---|---|
| **0** | DB migration + Adapter + sweep on startup + global search default-includes archived | v0.1.7 |
| **1** | Settings page archive summary + bulk-unarchive buttons | v0.1.7 |
| **2** | First-launch onboarding banner | v0.1.7 |

Phase 0+1+2 = the entire feature, in one v0.1.7 release. No per-item UI surface to build, test, or maintain.

## 11. Open Questions (resolve before implementation)

1. **Time-of-day handling for 日程 0-day threshold** — at 11pm Monday, archive a Tuesday event ending 10pm Tuesday? or wait until end-of-Tuesday? Proposal: use `ends_at < now` (instant as event is past).
2. **Project auto-archive requires terminal stage?** Yes — non-terminal stages can sit for years without archiving (active work).
3. **Settings bulk-unarchive limits** — 30 days default; make configurable later?
4. **Default global search** — keep "all" default or add an obvious "📦 已归档" filter chip? Proposal: keep "all" default (search is for finding); chip is optional.
5. **Long-term archive data** — never deleted in v2; future "purge archived older than X" setting can be added.

## 12. v0.1.7 Addendum — event end_at safety net

Added in the same v0.1.7 ship to prevent recurring "日程 丢了 结束时间" data and keep auto-archive deterministic (an event with no end_at fell outside the auto-archive rule, since `end_at` was the primary past-time check).

- `EventNew.tsx` — when `start_at` changes and `end_at` is empty or `<=` start, auto-fill `end_at = start_at + 60 min`. The `end_at` input is also marked `required`.
- `EventEdit.tsx` — same behavior after hydration, so editing an existing event also nudges `end_at` forward when the user pushes `start_at`.

Scope note: a v0.2 snap-to-15-min picker helper was prototyped and reverted in v0.1.7 after live testing — minute picker stays at native 1-min resolution; end_at safety net retained.

## 13. v0.1.7 Addendum — release-channel matrix

Added macOS to the release pipeline.

- `src-tauri/tauri.conf.json` — bundle targets now include `app` and `dmg`.
- `.github/workflows/release.yml` — new `build-macos` job (macos-latest, Rust targets `aarch64-apple-darwin,x86_64-apple-darwin`, produces universal `.app`/`.dmg`); `release` job `needs:` extended to include it.

