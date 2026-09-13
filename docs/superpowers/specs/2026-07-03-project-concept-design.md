# Project (项目) Concept — Optional Layer for Weavine

**Date:** 2026-07-03
**Status:** Design only — **NOT TO BE IMPLEMENTED** (user decision: 不要开发)
**Author:** Design discussion with user

## 1. Background

Weavine is a Personal Relationship Manager (人脉管理). It currently models:
- **联系人 (Contacts)** — people
- **待办 (Actions)** — to-dos
- **日程 (Events)** — calendar entries
- **互动 (Interactions)** — historical touchpoints
- **提醒 (Reminders)** — time-based alerts
- **标签 (Tags)** — flexible grouping

A friend wants to use Weavine for sales pipeline tracking: projects have a status (lead → qualified → won/lost), involve contacts, and generate meetings/actions. The user is considering whether to add an explicit **项目 (Project)** entity to model this kind of work.

## 2. Industry Analysis

### 2.1 Tools that have explicit Projects
- **Team / B2B:** Asana, Trello, Monday.com, ClickUp, Linear, Salesforce, HubSpot
- **Database / schema-flexible:** Notion (user-defined, not opinionated)

### 2.2 Tools that DO NOT have Projects
- **Personal CRMs:** Clay, folk, Affinity, Reflect, Dex
- They model "group of work" using **tags + groups**, not first-class entities.

### 2.3 Why personal CRMs skip projects
- Boundaries are blurry: is "help Xiao Ming with his startup" a project, a context, or a person?
- Frequency is low per contact compared to interactions
- Adding a project layer bloats the schema with edge cases (templates, permissions, custom fields, archive) that personal users rarely exercise

### 2.4 Our conclusion
Weavine should stay **PRM-first**. Project should be an **optional layer** for users who have project-tracking needs (sales, events, renovations, reunions). Users who don't need it should never see it.

> "Users don't have to use it, but those with sales or project tracking needs can."

## 3. Use Cases (generic, not just sales)

The Project entity should be generic enough to model:

| Use case | Stages |
|---|---|
| Sales pipeline | 线索 → 资格确认 → 报价 → 成单 / 丢单 |
| Birthday party | 规划 → 邀请 → 采购 → 完成 |
| Family trip | 想法 → 计划 → 预订 → 出行 → 复盘 |
| Home renovation | 立项 → 设计 → 施工 → 验收 |
| Class reunion | 提名 → 投票 → 确认 → 举办 |

Common pattern: **status machine + related contacts + related events + related actions**.

## 4. Design Decisions

### 4.1 Status model: per-project customizable
- Each project defines its own ordered stages
- Last stage is the **terminal** stage — moving into it auto-sets `completed_at = NOW()`
- No fixed "todo / in-progress / done" — that's what Actions already are

### 4.2 Stage entry: 3 preset templates
User picks one of three templates at project creation, then customizes the labels / order:

1. **通用项目** — `计划中 → 进行中 → 评审中 → 已完成 / 已搁置`
2. **销售管线** — `线索 → 资格确认 → 报价 → 成单 / 丢单`
3. **活动筹备** — `规划 → 邀请 → 采购 → 完成`

Rationale: free-form input would create a UX puzzle (validation, ordering, no good defaults); a single hard-coded default would be too narrow. Three presets cover ~80% of real cases.

### 4.3 Data Model

#### `project` table
| column | type | notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `owner_id` | TEXT NOT NULL | matches `contact.owner_id` pattern |
| `title` | TEXT NOT NULL | |
| `description` | TEXT NULL | |
| `status` | TEXT NOT NULL | current stage label (denormalized for fast filter) |
| `custom_stages` | TEXT NOT NULL | JSON `["stage1", "stage2", ...]`; last = terminal |
| `template` | TEXT NULL | `generic` / `sales` / `event`, or NULL for custom |
| `start_at` | TEXT NULL | ISO 8601 |
| `due_at` | TEXT NULL | ISO 8601 |
| `completed_at` | TEXT NULL | set automatically when status reaches terminal stage |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

#### `project_contact` join table
| column | type | notes |
|---|---|---|
| `project_id` | TEXT NOT NULL | FK → project.id, ON DELETE CASCADE |
| `contact_id` | TEXT NOT NULL | FK → contact.id, ON DELETE CASCADE |
| `role` | TEXT NULL | e.g. "决策人", "供应商", "参与者" |
| `added_at` | TEXT NOT NULL | |

Composite PK: `(project_id, contact_id)`.

#### Foreign keys on existing tables
- `action.project_id` (nullable, ON DELETE SET NULL)
- `event.project_id` (nullable, ON DELETE SET NULL)
- Both indexed for fast "show me actions in this project" queries.

### 4.4 UI Surfaces

- `/projects` — list view, kanban-style board grouped by stage
- `/projects/:id` — aggregate: contacts, actions, events, timeline
- `/projects/:id/edit` — edit metadata + reorder/rename stages
- Sidebar adds a "项目" entry below "待办" (toggleable per user later if we add visibility preferences)
- Action edit page: add "所属项目" picker
- Event edit page: same
- Contact detail page: "参与的项目" section (queries `project_contact` join)

### 4.5 Out of scope for v1 (YAGNI)
- Custom field definitions (rich text, numbers, dates on project)
- Per-user permissions / sharing projects
- Archive / soft-delete (delete is hard delete; "completed" is the only done state)
- Reports / analytics
- Templates beyond the 3 presets
- Project-to-project relationships (parent/child)

## 5. Delivery Plan (NOT STARTED)

Four incremental PRs, each independently shippable:

| PR | Scope | Estimate |
|---|---|---|
| 1 | Schema + migration + Rust handler (CRUD for project + project_contact) + Action.project_id / Event.project_id | 1–2 days |
| 2 | Frontend: /projects list + /projects/:id detail + sidebar entry | 1–2 days |
| 3 | Frontend: kanban board for /projects + @dnd-kit drag (reuses existing @dnd-kit investment) | 1 day |
| 4 | Picker: Action/Event edit pages get "所属项目" picker; Contact detail gets "参与的项目" section | 1 day |

Each PR is small enough to be reviewable in one sitting and reversible in one revert.

## 6. Open Questions (defer until implementation starts)

- Do we add `project` to the service worker precache list? (Probably yes, but small.)
- Do completed projects stay in the kanban or get filtered by default? (Default: stay, but grayed out.)
- Do stages have colors? (Probably yes, derive from a per-project color or from template.)
- Migration: how to handle the existing contacts who already have implicit "projects" in their description? (Out of scope; ignore for v1.)

## 7. Non-Goals (explicit)

- **Not a CRM replacement.** Salesforce / HubSpot are far more capable; we're a personal tool.
- **Not a task manager.** That's what Actions are. Projects aggregate Actions, not replace them.
- **Not team / collaborative.** No multi-user, no sharing.
- **Not a knowledge base.** Use Obsidian / Notion for that.

## 8. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-03 | Per-project customizable stages | Different use cases have fundamentally different lifecycles |
| 2026-07-03 | 3 preset templates, not free-form | Balance: covers 80% without validation UX overhead |
| 2026-07-03 | Last stage = terminal, auto `completed_at` | Simpler than explicit "close project" action |
| 2026-07-03 | Optional layer, not a default tab | Stay PRM-first; users opt in |
| 2026-07-03 | `do not implement` | User decision — design only for now |
