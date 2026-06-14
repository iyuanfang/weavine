# PRM — Personal Relationship Manager — Design Spec

**Date:** 2026-06-14
**Status:** Draft v1 (locked defaults, pending user review)
**Owner:** Sisyphus
**Project root:** `/home/yf/workspace/opencode/prm`

---

## 1. Purpose

A personal relationship manager that combines **contact management**, **schedule management**, **interaction logging**, **need/demand tracking**, and **tagging** — designed to help the user maintain and grow their network over time, surface the right people for the right situations, and never miss an important date.

Core jobs-to-be-done:

1. **Remember** people, how you met, and what they care about.
2. **Stay in touch** with reminders driven by events, birthdays, and the absence of recent contact.
3. **Find the right person** fast — by tag, free-text, or natural-language queries.
4. **Match needs to people** — when the user needs intro / advice / collaboration, find contacts who can provide it.

---

## 2. Scope and non-goals

### In scope (MVP / v1)

- Local single-user Web App (Next.js + SQLite).
- Contact CRUD with rich fields.
- Tagging (many-to-many).
- Events with calendar view, contact association, and reminders.
- Interaction timeline per contact.
- Need/Demand tracker with kanban workflow.
- Natural-language-style search (rule-based + FTS5).
- Browser-push reminders and in-app inbox.
- Chinese-first UI.

### Out of scope (deferred)

- Multi-user, auth, teams, roles.
- Cloud sync, mobile app, native packaging (Tauri/Electron is a v2 option, not a v1 deliverable).
- Email / SMS / WeChat integration.
- File attachments in v1 (free text + URL links only).
- vCard / CSV import/export (v2).
- Internationalization beyond zh-CN (v2).
- Embedding-based semantic search (v2; v1 uses FTS5 + heuristics).
- Sales-pipeline-style CRM features.

---

## 3. Locked default assumptions

These were defaulted because the user did not respond to clarifying questions. Any of these can be overridden.

| # | Dimension | Default | Override path |
|---|---|---|---|
| 1 | Deployment | Local single-user, runs on `localhost` | Move to a hosted server or add multi-user |
| 2 | Platform | Web App (desktop + mobile browser) | Wrap in Tauri/Electron for native desktop |
| 3 | Data scale | Hundreds to a few thousand contacts | Switch to Postgres if larger |
| 4 | Language | zh-CN UI primary | Add i18n |
| 5 | Reminder channel | Browser push + in-app inbox | Add email / WeChat later |
| 6 | Search v1 | FTS5 + jieba + rule-based NL parser | Move to vector search in v2 |
| 7 | Storage | SQLite single file | Move to Postgres |
| 8 | Auth | None | Add in v2 if multi-user |
| 9 | Browser support | Latest Chrome / Edge / Safari / Firefox | Drop legacy if needed |

---

## 4. Architecture

### 4.1 High-level

```
┌─────────────────────────────────────────────────────┐
│                  Browser (Client)                   │
│  Next.js App Router · React · Tailwind · shadcn/ui  │
│  TanStack Query · Service Worker (Web Push)         │
└──────────────┬──────────────────────┬────────────────┘
               │ fetch (RSC + actions) │ Web Push
┌──────────────▼──────────────────────▼────────────────┐
│            Next.js Server (Node.js process)         │
│  Route Handlers / Server Actions                    │
│  Domain services (ContactService, EventService,     │
│    NeedService, SearchService, ReminderService)     │
│  node-cron scheduler                               │
└──────────────┬──────────────────────────────────────┘
               │ Prisma
┌──────────────▼──────────────────────────────────────┐
│                 SQLite (prm.db)                     │
│  Tables + FTS5 virtual table (contact_fts)          │
└─────────────────────────────────────────────────────┘
```

Single Node process. Single SQLite file. One-command boot.

### 4.2 Module boundaries

Domain services are pure functions over the data layer. Each service exposes a small, intention-revealing API. Server actions and route handlers are thin wrappers that adapt HTTP shapes.

| Service | Responsibility | Public API (sketch) |
|---|---|---|
| `ContactService` | CRUD, tag assignment, derived fields (`lastInteractionAt`) | `list`, `get`, `create`, `update`, `delete`, `addTag`, `removeTag`, `search` |
| `TagService` | Tag CRUD, contact counts per tag | `list`, `create`, `update`, `delete`, `merge` |
| `EventService` | Event CRUD, recurrence expansion, contact linkage | `list`, `get`, `create`, `update`, `delete`, `listForContact`, `listInRange` |
| `InteractionService` | Quick-log interactions, timeline query | `create`, `listForContact`, `listRecent` |
| `NeedService` | Need kanban transitions, match-by-need | `list`, `create`, `update`, `transition`, `search` |
| `SearchService` | NL parsing → structured query, FTS5 execution | `parse(query)`, `execute(parsed)` |
| `ReminderService` | Schedule, dispatch web push, mark read | `schedule`, `dispatchDue`, `list`, `dismiss` |
| `BirthdayService` | Auto-create annual reminder from contact DOB | `ensureForContact`, `listUpcoming` |

### 4.3 Data flow

1. **Read** — Server Components fetch via domain services, hydrate via TanStack Query where interactive.
2. **Write** — Server Actions call services; services enforce invariants and write via Prisma in a transaction when touching multiple tables.
3. **Search** — Client posts query to `/api/search`; server returns parsed intent (debug) + result rows.
4. **Reminder** — node-cron runs every minute; finds due reminders not yet dispatched; sends Web Push + inserts in-app inbox entry.

### 4.4 Error handling

- Service layer throws typed errors: `NotFoundError`, `ValidationError`, `ConflictError`.
- Server actions catch and convert to `ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code; message } }`.
- UI surfaces errors via toast; non-fatal read errors fall back to empty state with retry.
- Cron jobs log and continue; never crash the process.

---

## 5. Data model

Prisma schema sketch (SQLite dialect):

```prisma
model Contact {
  id              String   @id @default(cuid())
  name            String                    // primary name
  alias           String?                   // 昵称 / 英文名
  avatarUrl       String?
  company         String?
  title           String?                   // 职位
  city            String?
  phone           String?
  wechat          String?
  email           String?
  source          String?                   // 怎么认识的
  birthdayMonth   Int?                      // 1-12 (生日, 仅月日, 不存年; 避免"生于何年"的不确定性)
  birthdayDay     Int?                      // 1-31
  notes           String?                   // markdown ok
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastContactedAt DateTime?                 // derived, denormalized

  tags            ContactTag[]
  interactions    Interaction[]
  events          EventAttendee[]
  needs           Need[]

  @@index([name])
  @@index([company])
  @@index([city])
}

model Tag {
  id        String   @id @default(cuid())
  name      String   @unique
  color     String   @default("#888888")    // hex
  createdAt DateTime @default(now())

  contacts  ContactTag[]
}

model ContactTag {
  contactId String
  tagId     String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([contactId, tagId])
  @@index([tagId])
}

model Event {
  id          String   @id @default(cuid())
  type        String   // meeting | birthday | anniversary | reminder | custom
  title       String
  description String?
  startsAt    DateTime
  endsAt      DateTime?
  location    String?
  recurrence  String?  // RRULE string or null
  remindOffsets String? // JSON array of minutes before start: [0, 1440, 10080]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  attendees   EventAttendee[]
  reminders   Reminder[]
}

model EventAttendee {
  eventId   String
  contactId String
  event     Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@id([eventId, contactId])
  @@index([contactId])
}

model Interaction {
  id          String   @id @default(cuid())
  contactId   String
  type        String   // meeting | wechat | call | email | gift | other
  summary     String   // free text
  occurredAt  DateTime @default(now())
  contact     Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  @@index([contactId, occurredAt])
}

model Need {
  id          String   @id @default(cuid())
  contactId   String?
  // category 取值（用 String 不用 enum，便于后续自定义）:
  //   交流 | 合作 | 咨询 | 介绍 | 帮忙 | 其他
  category    String
  title       String
  description String?
  // status 取值: open | in_progress | done | dropped
  status      String   @default("open")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  dueAt       DateTime?

  contact     Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  @@index([status])
  @@index([category])
}

model Reminder {
  id          String   @id @default(cuid())
  eventId     String?
  contactId   String?  // for birthday/anniversary/contact-stale reminders
  title       String
  fireAt      DateTime
  dispatchedAt DateTime?
  dismissedAt DateTime?
  source      String   // event | birthday | need | contact_stale
  event       Event?   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  @@index([fireAt])
  @@index([dispatchedAt])
}
```

### 5.1 Derived / denormalized fields

- `Contact.lastContactedAt` — updated by an `Interaction` write trigger / service call; not user-editable.
- `Reminder.fireAt` — computed from `Event.startsAt − offset` and persisted; not recomputed at read time (cron iterates by index).

### 5.2 Search support (FTS5)

A virtual table `contact_fts` indexes `name`, `alias`, `company`, `title`, `city`, `notes`, `source` plus denormalized tag names. Updated by triggers on Contact / ContactTag writes.

Chinese text is pre-segmented with `jieba` (Node binding) before insertion into FTS5. The `jieba_dict` is a build-time dep; for unknown proper nouns we fall back to trigram (`LIKE %q%`) on `name`.

### 5.3 Migration strategy

- `prisma migrate dev` for iterative dev.
- `prisma migrate deploy` for any future deploy. The first migration creates the FTS5 virtual table and triggers via `prisma db execute --file`.

---

## 6. Natural-language search (v1)

### 6.1 Parser

Input: `"住在上海的投资人 上次见面的"` style queries.
Output: `ParsedQuery = { filters: Filter[], textQuery: string, sort?: SortSpec, limit?: number }`.

`Filter` shapes: `{ field: 'tag' | 'city' | 'company' | 'category', op: 'is' | 'is_not', value: string }` plus derived filters like `{ field: 'lastContactedAt', op: 'older_than', value: Duration }` and `{ field: 'hasNeed', op: 'in', value: string[] }`.

### 6.2 Recognized intents (v1)

| Phrase (zh) | Compiled filter |
|---|---|
| `住在 X` / `在 X` | `city = X` |
| `在 X 公司` / `X 的` | `company = X` (when X is in known companies list) |
| `#标签` | `tag = label` |
| `投资人 / 技术 / 产品` (when in known categories) | `tag` or `category` filter |
| `上次见面` / `最近联系` | sort by `lastContactedAt desc` |
| `还没联系` / `好久没见` | `lastContactedAt < now − 90d` or null |
| `有合作需求` | `hasNeed category=合作 status=open` |
| `生日在本月` | `birthdayMonth = currentMonth` |

Unknown words fall through to FTS5 `textQuery`. The result page surfaces the parsed intent as a chip strip so the user can see how the query was interpreted and click chips to refine.

### 6.3 Result shape

```ts
type SearchResult = {
  parsed: ParsedQuery;          // for UI display
  contacts: Array<Contact & { _matchedTags: string[] }>;
  total: number;
};
```

### 6.4 Failure modes

- Empty result → show "no match" + suggest removing last filter.
- Parser fails entirely → return whole query as FTS5 input, no filters.

---

## 7. Reminder and scheduling

### 7.1 Sources

- `Event.remindOffsets` (per event) → spawn `Reminder` rows on event create/update.
- `Contact.birthdayMonth / birthdayDay` → `BirthdayService.ensureForContact` spawns annual reminders for the next 12 months.
- `Contact` with no `Interaction` for 90 / 180 / 365 days → `ReminderService` lazy-creates a "好久没联系" reminder at the next bucket boundary (idempotent per day per contact).

### 7.2 Dispatch

- node-cron every minute: `SELECT * FROM Reminder WHERE fireAt <= now AND dispatchedAt IS NULL AND dismissedAt IS NULL`.
- For each, send Web Push to all subscribed endpoints; mark `dispatchedAt`.
- Always insert/update an in-app inbox row regardless of push subscription, so reminders are never lost.

### 7.3 Push subscription

- Service Worker registers `/sw.js`.
- On first load with permission granted, client posts subscription to `/api/push/subscribe`; server stores endpoint + keys in a `PushSubscription` table (not modeled above, add during impl).

---

## 8. UI / pages

| Path | Render mode | Purpose |
|---|---|---|
| `/` | Server Component | Dashboard |
| `/contacts` | Server (list) | List + filter |
| `/contacts/[id]` | Server | Detail (timeline, needs, events) |
| `/contacts/new` | Client form | Create |
| `/contacts/[id]/edit` | Client form | Edit |
| `/calendar` | Client (FullCalendar) | Month/week/list |
| `/events/new` | Client form | Create event |
| `/events/[id]/edit` | Client form | Edit |
| `/tags` | Server | Manage tags |
| `/needs` | Client (kanban) | Kanban board |
| `/needs/new` | Client form | Create need |
| `/search` | Server (with client refinement) | NL search |
| `/inbox` | Server | Reminder inbox |
| `/settings` | Server | Reminder defaults, push setup, export |

Visual style: shadcn/ui `default` theme, neutral grays + one accent color (blue). No marketing-page drama. Dense lists, keyboard-friendly, single-column on mobile.

---

## 9. Key user flows

### 9.1 Add a new contact

1. `/contacts/new` → fill form → submit.
2. Server action: `ContactService.create` writes row, attaches tags, enqueues birthday reminder if `birthdayMonth+Day` set.
3. Toast "已添加"; redirect to detail page.

### 9.2 Log a meeting

1. From `/contacts/[id]`, click "记一次互动".
2. Modal: type = meeting, summary text, occurredAt (default now).
3. Service updates `lastContactedAt`, redirects back to detail; new entry appears in timeline.

### 9.3 Schedule a meeting with two people

1. `/events/new` → type meeting, set start/end, location, pick 2 contacts from combobox.
2. Set `remindOffsets: [60, 1440]` (1h + 1d before).
3. `ReminderService.schedule` creates 2 Reminder rows.
4. On the day, browser push fires; inbox row created.

### 9.4 Find someone for a need

1. `/needs` → click "有合作意向要找产品经理".
2. Click a Need card → side panel shows matching contacts (rule-based + tag overlap).
3. One-click "约个时间" opens `/events/new` pre-filled with that contact.

### 9.5 NL search

1. Top-bar search input → query goes to `/search?q=...`.
2. Parser produces chips, results show below.
3. Click a chip to remove; query re-runs.

---

## 10. Testing strategy

- **Unit** (Vitest): `SearchService` parser table-driven tests, `BirthdayService` recurrence tests, `ReminderService` dispatch idempotency.
- **Integration** (Vitest + in-memory SQLite): service-level flows (create contact → log interaction → lastContactedAt updates; create event → reminder spawned).
- **E2E** (Playwright): one happy path per page (`/contacts/new`, `/events/new`, `/needs`, `/search`).
- **Manual smoke** checklist in `README.md` covering all 7 acceptance criteria.

Coverage target: services ≥ 80% lines, parser table 100%.

---

## 11. Acceptance criteria (MVP done = all checked)

- [ ] `pnpm install && pnpm dev` boots the app on `localhost:3000` against a fresh SQLite file.
- [ ] Can create a contact with tags, see it in the list, filter by tag.
- [ ] Can create an event, attach 1+ contacts, see it on the calendar, get a browser-push reminder at the configured offset.
- [ ] Can log an interaction; the contact's `lastContactedAt` updates and shows in the timeline.
- [ ] Can create a need, transition it open → in_progress → done, and see it on the kanban.
- [ ] NL search returns correct results for at least these 5 sample queries:
  - `住在上海的投资人`
  - `上次见面的产品经理`
  - `还没联系的老同学`
  - `生日在本月`
  - `有合作需求的设计师`
- [ ] Single-file SQLite backup is portable: copying `prm.db` to a fresh checkout works.
- [ ] No external services required (no LLM key, no email, no cloud).

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chinese segmentation quality in jieba misses proper nouns | Fallback to trigram `LIKE` on `name`; user can edit aliases. |
| Web Push requires HTTPS except on `localhost` | Document; provide instructions for self-host. |
| SQLite write contention under heavy cron | Reminder dispatch is a single short transaction per tick; no UI writes from cron. |
| Single-user assumption breaks if shared on LAN | v2 gating: flag at boot if binding to non-loopback, refuse without explicit `--allow-network` flag. |
| Schema drift between Prisma and FTS5 triggers | A smoke test on CI opens a fresh DB and asserts the FTS5 table is populated. |

---

## 13. Open questions for user (post-spec)

These can be decided during implementation; defaults are listed.

1. Default reminder offsets for events? Default: `[60, 1440]` (1h + 1d before).
2. Default "stale contact" thresholds? Default: 90 / 180 / 365 days.
3. Default event types and their icons? Default: meeting, birthday, anniversary, reminder, custom.
4. Default need categories? Default: 交流, 合作, 咨询, 介绍, 帮忙, 其他.
5. Should the dashboard show a count of total contacts and total events? Default: yes.
6. Color for the accent? Default: blue.

---

## 14. Next step

Move to `superpowers/writing-plans` to break this spec into an implementation plan with explicit verification steps per task.
