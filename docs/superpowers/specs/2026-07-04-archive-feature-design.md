# Archive (归档) — Product Design v1

**Date:** 2026-07-04
**Status:** Design only — awaiting implementation approval
**Author:** Design discussion with user (transcribed by Sisyphus)

## 1. Background

Weavine currently models 联系人 / 待办 / 日程 / 项目 / 互动 / 提醒 / 标签。Nothing supports graceful retirement of records that are not currently relevant but should not be deleted.

As data accumulates:

- **项目列表 (ProjectsList)** — completed sales pipeline projects (丢单 / 中标) clutter the active view; users hesitate to delete because the data is real history.
- **待办列表 (ActionsList)** — "全部" view pulls in 30-day-old completed items; the existing "已完成" tab only segments by status, not by recency.
- **日程视图 (Calendar)** — events from weeks ago still show in upcoming lists; month navigation is the only temporal filter.

The user proposed an 归档 (archive) feature during review of v0.1.6:

> 归档后页面上不再展示，只在联系人页面展示

This design captures the agreed direction with refinements.

## 2. Design Decisions

### 2.1 Archive ≠ delete ≠ hide-filters

Three distinct operations, semantic boundary:

| Operation | Meaning | Reversible? | Confirmation |
|---|---|---|---|
| **归档** | Remove from active views; keep in DB | 1 click to unarchive | Optional |
| **删除** | Permanently remove | No | Required double confirm |
| **Hide filters** | Just visually filter | Always reversible | None |

The product offers all three; users pick the right tool per situation.

### 2.2 Archive lives at the entity level, not the contact page

**Decision (refined from user's original proposal):** archived items are surfaced on each entity's list page via a toggle, and on the contact page as a collapsible, secondary panel — **not** as primary content on the contact page.

**Why this departs from the user's idea:**

- Contact page primary purpose is "who is this person". Stuffing unrelated archived projects into it pollutes the information hierarchy.
- Cross-references: an archived project linked to 3 contacts has no clean "home" contact.
- Discoverability: a contact-page-only archive creates a dead-end when the user remembers "I archived a project last month" but not which contact it relates to.

**Surfacing pattern:**

- Each entity list page (待办 / 日程 / 项目) — toggle "显示已归档" in its filter panel
- Contact page — each "关联待办 / 项目 / 日程" group has a collapsible footer line "归档 N 项 [▼]" that expands to show the archived items as a sub-list, visually de-emphasized
- Global search `/search` — includes archived by default; result rows show a 📦 badge; offers "仅显示活跃" filter

### 2.3 No cascade, no auto-archive

- **No cascade:** archiving a project does NOT archive its linked actions/events. Active items remain active.
- **No auto-archive by time:** the user retains full control. A settings-page utility button ("批量归档 30 天前已完成待办") can do bulk operations on demand, but never silently.

### 2.4 Schema addition only

A single nullable column per table — `archivedAt TEXT` — is the only schema change. No type discriminator, no new tables, no migration of existing data (everything stays `NULL` = active).

## 3. Data Model

```sql
ALTER TABLE Action  ADD COLUMN archivedAt TEXT;  -- ISO timestamp or NULL
ALTER TABLE Event   ADD COLUMN archivedAt TEXT;
ALTER TABLE Project ADD COLUMN archivedAt TEXT;

CREATE INDEX idx_action_archivedAt   ON Action(archivedAt);
CREATE INDEX idx_event_archivedAt    ON Event(archivedAt);
CREATE INDEX idx_project_archivedAt  ON Project(archivedAt);
```

Semantics:

- `archivedAt IS NULL` → active (default)
- `archivedAt IS NOT NULL` → archived; timestamp = when archived, used for sorting and UI display

## 4. API Surface

Reuse existing PUT for archive/unarchive — no new endpoints:

```
GET  /api/actions?archived=false          # default, only active
GET  /api/actions?archived=true           # only archived
GET  /api/actions?archived=all            # everything (used by global search)
                                            # same params for events / projects

PUT  /api/actions/:id  { archived_at: <iso> | null }    # archive or unarchive
PUT  /api/events/:id   { archived_at: <iso> | null }
PUT  /api/projects/:id { archived_at: <iso> | null }

POST /api/actions/batch  { ids: [...], op: "archive" | "unarchive" | "delete" }
POST /api/events/batch
POST /api/projects/batch
```

`archived_at` field in PUT body toggles state: setting to current ISO timestamp archives; setting to `null` unarchives.

`batch` endpoint exists to avoid N round trips for multi-select operations; single record operations still use PUT.

## 5. UI Behavior

### 5.1 Entity list pages

Each list page's filter panel gains a top-row toggle:

```
┌─────────────────────────────────────────┐
│ [📦 显示已归档]   17 项                 │  ← always visible
├─────────────────────────────────────────┤
│ 搜索 [          ]                      │
│ 状态 ...                               │
│ 模板 ...                               │
└─────────────────────────────────────────┘
```

When toggle is OFF and there are archived items, show an inline hint once:

```
这里有 23 项 30 天前完成的事，已自动隐藏。 [打开归档视图]
```

The hint appears at most once per session, dismissible.

### 5.2 Entity detail pages

**Active state (no archive banner):**

```
┌──────────────────────────────────────────────┐
│ ← 列表    编辑    [归档]    [永久删除]        │
├──────────────────────────────────────────────┤
│ ... 详情字段 ...                             │
└──────────────────────────────────────────────┘
```

**Archived state:**

```
┌──────────────────────────────────────────────┐
│ 📦 此项已于 2026-04-12 归档                   │  ← yellow notice
├──────────────────────────────────────────────┤
│ ← 列表    [取消归档]    [永久删除]            │  ← different buttons
├──────────────────────────────────────────────┤
│ ... 详情字段 (dimmed, opacity 0.6) ...        │
└──────────────────────────────────────────────┘
```

- 取消归档 = green primary button → PUT archived_at=null → invalidates queries → navigation back or stay
- 永久删除 = red → confirm modal "确认永久删除「XXX」？此操作不可撤销。" → DELETE

### 5.3 Archived item visual treatment (any list)

- Row opacity 0.6
- Right side: 📦 badge with archive date
- Title not struck-through (preserves readability); background tint `#f9fafb`

### 5.4 Contact page cross-references

For each entity group with linked items at the bottom of the section:

```
关联项目 (5)
  - [项目A] 活跃    阶段: 计划       →
  - [项目B] 活跃    阶段: 中标       →
  - [项目C] 活跃    阶段: 丢单       →
  ...
  ─── 分隔线 ───
  归档 3 项 [▼ 展开]      ← 折叠态
```

展开后:

```
  ─── 分隔线 ───
  归档 3 项 [▲ 收起]
  📦 已归档 [项目D]  - 2026-04-12 归档  →
  📦 已归档 [项目E]  - 2026-03-30 归档  →
  📦 已归档 [项目F]  - 2026-02-08 归档  →
```

Only relevant entity groups show this — if no archived items in a group, no footer line.

### 5.5 Today / Calendar temporal views

Archived items **never appear** in:

- `/` 今天 page (today/due/overdue sections)
- `/calendar` 任何时间的日程块
- "Upcoming N days" widgets on dashboard

If something is overdue AND archived → it stays hidden, never nag. This is the core privacy guarantee.

### 5.6 Global search `/search`

- Default scope: include both active and archived
- Each result row carries 📦 badge when archived (next to existing metadata badges)
- Filter chips at top: `全部 / 仅活跃 / 仅归档` (default 全部)

### 5.7 Multi-select + batch operations

Lists with checkbox column (项目 already has one; add to 待办 / 日程):

```
☑ 已选 5 项   [归档]  [取消归档]  [永久删除]    [✕]
```

Bar appears when ≥ 1 selected. Disappears on × click.

### 5.8 First-visit empty state

When user opens an archived view for the first time and sees an empty list:

```
📦 这里放着所有不急但舍不得删的事。

[关掉 · 暂不归档任何东西]   [看看怎么用]
```

Dismissible. Doesn't repeat.

## 6. Delete semantics

Two distinct operations:

| Confirmed intent | Path |
|---|---|
| "Hide from view, keep data" | 归档 |
| "Erase, no recovery" | 永久删除 |

**Delete confirmation flow:**

1. Click [永久删除]
2. Modal: "确认永久删除「XXX」？此操作不可撤销。"
3. Required: type title text OR click checkbox "我已了解此操作不可撤销"
4. Confirm → DELETE

The double-gate is intentional — it ensures the user really means it, especially for items they may have spent time creating.

Archived items also accept 永久删除 (no different rule), since the same data-loss risk applies.

## 7. Bulk utility (settings)

A single utility button lives in `/settings` under a "数据整理" section:

```
▢ 批量归档「X 天前已完成的待办」    [执行]
▢ 批量归档「X 天前已结束的日程」    [执行]
▢ 批量归档「非最终阶段 90 天前的项目」  [执行]
```

- Each button opens a confirmation modal with a preview count: "将归档 23 项，确认？"
- No silent background jobs
- "X" defaults: 待办 30 天, 日程 7 天, 项目 90 天 — configurable per utility

This is the user-triggered auto-archive. Never automatic. Manual unarchive remains 1 click from any list page.

## 8. Acceptance Criteria

A release is shippable when all of the following hold:

- [ ] DB migration adds `archivedAt` cleanly to all 3 tables; new column nullable
- [ ] All existing PUT requests still work; new `archived_at` field round-trips correctly
- [ ] Each list page (待办 / 日程 / 项目) supports `?archived=false|true|all`
- [ ] Filter panel shows the toggle; OFF by default; warning count when archived > 0 and toggle OFF
- [ ] Detail page banner appears for archived items; 取消归档 / 永久删除 buttons both work
- [ ] Archived visual (opacity 0.6 + 📦 badge) consistent across all list pages
- [ ] Contact page cross-reference footer: collapsed by default; expanded shows archived sub-list with separators
- [ ] Today page and calendar view **never** include archived items (manually verified)
- [ ] Global `/search` includes archived by default; 📦 badge on result rows; filter chips work
- [ ] Multi-select with batch archive / unarchive / delete operations
- [ ] Bulk utility in `/settings` with the three operations and confirmation modals
- [ ] Delete confirmation modal requires deliberate intent confirmation
- [ ] No existing user workflow breaks (data integrity: existing records all stay NULL = active)
- [ ] Performance: filtering by `archivedAt` uses index; no N+1 regressions

## 9. Open Questions (resolve before implementation)

1. **Should "今日" page show items due-today that are archived?** (see 5.5 — current proposal says NO, but user could argue archived-still-due is "I have to deal with this today")
2. **Should there be a "归档到项目 [X]" action?** i.e., archiving a todo also offers "actually let's track this under a project" — interact with project flow
3. **Filter UI: toggle vs segmented?** Toggle is simpler, segmented is more discoverable. Proposal: toggle, can revisit
4. **Cross-entity bulk unarchive?** E.g., "I unarchived this project, should I unarchive all its related actions too?" — current proposal says NO cascade, but UX hint might be worth a second look

## 10. Phased Rollout

Each phase ships independently; user can stop after any phase:

| Phase | Scope | Tag |
|---|---|---|
| **0** | DB migration + Adapter layer + `archived` query param | v0.1.7 |
| **1** | Detail page banner + 归档/取消归档 button + 永久删除 with confirmation | v0.1.7 |
| **2** | List page toggle + 归档态 visual + warning hint | v0.1.7 |
| **3** | Contact page cross-reference footer (collapse/archive sub-list) | v0.1.8 |
| **4** | Multi-select + batch operations (archive / unarchive / delete) | v0.1.8 |
| **5** | Bulk utility in `/settings` | v0.1.9 |

Phase 0+1+2 = the core (user can archive from any item and view archived items in a dedicated toggle). Subsequent phases enhance cross-page and bulk flows.

## 11. Decisions Log

| Decision | Choice | Rejected alternative |
|---|---|---|
| Where to surface archived items | Entity list toggle + contact page collapsible footer | User proposal: contact page primary |
| Time-based auto-archive | Off, with manual utility on settings | Auto by 90/30/7 days rule |
| Cascade on archive | Off | Cascade to related actions/events |
| Schema change | Add nullable timestamp column | New table, type discriminator |
| API style | Reuse PUT + add batch endpoint | New archive/unarchive endpoints |
| Version bump | Stay in v0.1.x progressive | Bump to v0.2.0 |
| Delete confirmation | Required deliberate intent (type or checkbox) | Simple click confirmation |

---

**Next step:** wait for user approval on this spec. Once approved, the phased rollout begins at Phase 0.
