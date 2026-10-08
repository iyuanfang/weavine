# weavine roadmap from competitor research (2026-08-22)

**Status**: Research only — no implementations started yet.
**Sources**: Clay, Folk, Dex, Covve, OnePageCRM, Monica, Twenty, Bonds, PingCRM, Mob, 销售易, 微伴, 尘锋, 腾讯云营销云, etc. Three parallel librarian sweeps compiled into this doc.

## TL;DR — what to build next

Weavine already has the data for most of these. Top wins ship in 1–2 weeks each:

| Rank | Feature | Source convergence | Cost | Why |
|------|---------|--------------------|------|-----|
| 🥇 | **Relationship health score** (auto from `last_interaction_at` + `importance`) | Dex, PingCRM, Savvo, Drift, Known | **S** | Pure derived column. Visual indicator on contact list. |
| 🥈 | **Keep-in-touch reminders** (recompute due date from last interaction + cadence tier) | Dex KIT, OnePageCRM, Obsidian-PRM | **S** | Replaces static recurring reminders. Core PRM value. |
| 🥉 | **Voice → structured note** (LLM extraction: name, action, follow-up date) | Dex AI cleanup, Dhaga, Rolomind | **S** | Natural evolution of existing voice memo. |
| 4 | **MCP server** (`/mcp` endpoint, ~8 tools: search/get/create contact, log note, set reminder) | Dex, Folk, OnePageCRM, Twenty, Bonds, Mob | **M** | "Chat your CRM" — the strategic pattern of 2026. |
| 5 | **Daily digest** (consolidated "who to reach out to" view) | Dex digest, Savvo Next 3 Moves, Connected | **S** | Replaces reminder spam with one prioritized view. |
| 6 | **iCal subscription feed** (`GET /api/calendar/feed.ics?token=…`) | Rvnx.CRM, Monica | **S** | ~100 lines. Users already check calendars. |
| 7 | **Chinese holiday auto-greeting** (春节/中秋/国庆 → suggested messages) | 畅易 SCRM | **S** | Weekend feature. Local market resonance. |
| 8 | **Custom fields** (user-defined contact properties) | Dex, Folk, Orvo | **S** | Foundation for smart lists. |
| 9 | **D3.js network graph** (who knows whom) | Nametag, Philotes | **M** | Visual "wow" — `contact_relationship` table is small. |
| 10 | **How-we-met field + Gift/debt ledger** | Monica, Bonds, Kindred | **S** | Solves real social pain. Cheap schema add. |

## What weavine already has (competitors lack)

| Capability | Weavine | VC tools | OSS tools |
|------------|---------|----------|-----------|
| Desktop SQLite + offline-first | ✅ Tauri | ❌ (Clay, Folk = cloud) | ⚠️ (only Bonds, Twenty) |
| On-device OCR business card scan | ✅ | ⚠️ (Cloud-only) | ❌ |
| On-device voice (Android sherpa-onnx) | ✅ | ❌ | ❌ |
| Chinese localization | ✅ | ❌ | ❌ (Monica partial) |
| Two-stack sync (desktop ⇄ cloud) | ✅ (Postgres) | ❌ | ❌ |
| MCP integration | ❌ — opportunity | ✅ (Dex, Folk, Twenty) | ✅ (Bonds, Mob) |

Weavine is **already ahead** on data portability, offline, and Chinese UX. The gap to fill is **AI/relationship intelligence layer** that VC tools have built and weavine hasn't.

## What weavine lacks (full feature inventory)

### AI / intelligence layer (4× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| MCP server (8 tools, read+write) | Dex, Folk, Twenty, Bonds, Mob | M | The single biggest strategic move. ~12 tools, OAuth-scoped. |
| AI relationship summary ("TL;DR before a call") | OnePageCRM, Folk Recap, Dex | M | One LLM call per contact — uses existing notes/interactions. |
| AI follow-up suggestions (quiet conversation detection) | Folk Follow-up, Clay Nexus, Dex Shuffle | M | Needs email ingestion OR manual note sentiment analysis. |
| Pre-meeting brief (auto-emailed 30 min before) | Dex, Orvo, Hyphae | S-M | Calendar + notes → LLM → email. |
| Conversation starter AI (one-click draft) | Dex AI Assist, Circle CRM, PineChat | S | One LLM call from `last_interaction` + profile. |
| Commitment extraction ("I'll send the deck by Friday" → action item) | Savvo | S | LLM pass over recent notes. |
| AI meeting review (transcript → decisions/actions) | Meaningful, PepoSmart | S | Use existing voice ASR + LLM extraction. |
| Voice-to-CRM (ASR → structured fields) | Dhaga, Rolomind | S | Extension of existing voice memo. |
| Smart follow-up priority queue | Savvo Next 3 Moves, PineChat | S | Re-ranked view using health score + commitments. |
| Contact auto-enrichment (Apollo/Clearbit) | Clay, Folk Research, Covve | L | Likely skip — provider costs + maintenance. |
| Mail merge AI | Dex, Folk | L | Skip for personal CRM. |
| News engine for contacts | Covve | L | Skip — news API cost. |

### Relationship intelligence (4× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| Keep-in-touch reminders | Dex KIT, OnePageCRM, Obsidian-PRM | S | Core PRM value prop. |
| Relationship health score | Dex, Clay Mesh, Covve, PingCRM, Drift | S | Already have `last_interaction_at`. |
| "Losing touch" suggestions | Kindred, Dex, Obsidian-PRM | S | One query away. |
| Pre-meeting brief (see AI) | — | — | — |
| Job change alerts | Dex, Folk folkX, Clay | L | Skip — LinkedIn API restricted. |
| News engine (see AI) | — | — | — |

### Grouping / segmentation (3× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| Custom fields (user-defined contact properties) | Dex, Folk, Orvo | S | JSONB column or EAV table. |
| Smart lists / dynamic filters | Clay Audiences, Dex | M | Depends on custom fields. |
| Map view (geographic) | Dex, YourPond, Covve | S | Leaflet + lat/lng. |
| Related contacts / connection edges | YourPond, Dex | M | New `contact_relationship` table. |
| Multi-select batch operations | Dex | S | shift+click + batch endpoint. |
| Timeline filters (notes/emails/meetings) | Dex | S | UI toggle on existing timeline. |

### Sync / integrations (2× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| Calendar sync (Google/Outlook) | Dex, Folk, OnePageCRM | M | Google Calendar API + OAuth. |
| Email sync (read contacts from signature/threads) | Dex, Folk, Covve | L | High effort; WeChat export is China proxy. |
| Chrome extension (LinkedIn one-click) | Folk folkX, Dex, Streak | M | Manifest V3 + content script. |
| Share extension (mobile share sheet) | Dex | M | Mobile-only; not relevant yet. |
| Home/Action-button widgets | Dex, Weft, Connected | L | Mobile-only. |
| WeChat 公众号/好友导入 | China market | M | Solves "how did we meet" gap. |
| 企微会话存档 (WeChat Work chat archive) | 销售易 NeoAgent | L | B2B feature; probably skip. |

### Capture / creation (3× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| Multi-card batch OCR | Dex, Covve | M | Currently single-card. |
| Smart paste (clipboard → contact) | MS Dynamics Data Entry Agent | M | Big UX win for "I just met someone". |
| Digital business card (QR + share page) | Covve, Dex | S | Static page + QR generator. |
| QuickLog one-click activity | Rvnx.CRM | S | `POST /api/contacts/:id/quicklog`. |
| Rebuilt card scanner (60+ langs) | Dex, Covve | M | OCR engine swap. |

### Niche / "feels 2026" (5× cited)

| Feature | Source | Cost | Notes |
|---------|--------|------|-------|
| **MCP server** (see AI) | — | — | Strategic. |
| Daily digest | Dex, Connected | S | Aggregate view + sort. |
| Dex Shuffle (serendipitous reconnect) | Dex | S | Daily cron + similarity heuristic + LLM draft. |
| Gift & debt ledger | Monica, Bonds, Kindred | S | New tables; high social value. |
| How-we-met field | Monica, Philotes | S | One text column. |
| Pet tracking | Monica, Bonds, Kindred | M | Niche but emotional. |
| Nameday support | PeopleVault | L | EU-only; skip. |
| Network graph (D3.js) | Nametag, Philotes | M | Visual "wow". |
| Mood journal | Bonds, Monica | S | One enum field. |
| Shoutrrr/Telegram notifications | Bonds | S | One config + HTTP call. |
| Biometric lock | Tauri biometric API | S | One toggle. |
| Encrypted local export | PO Contacts, PrivateContacts | M | Data portability promise. |
| WebAuthn passkey login | Bonds | M | Strategic; needs NestJS + Tauri work. |
| 微信小程序/MCP bot | Sales易 | M | China market. |
| CardDAV / CalDAV sync | Bonds, Meerkat | M | Phone contacts app sync. |
| iCal subscription feed | Rvnx.CRM | S | ~100 lines. |
| CJK full-text search | Bonds | M | Postgres `pg_trgm` or local Bleve. |
| Chinese holiday auto-greeting | 畅易 SCRM | S | Calendar table + auto-suggest. |
| 渠道活码 (Dynamic QR per source) | 微伴 | M | "Where did this contact come from?" attribution. |

## What to SKIP (for now)

- **LinkedIn sync / job change alerts** — API restrictions, maintenance burden
- **News engine** — news API costs + relevance tuning = low ROI
- **Mail merge AI** — out of scope for personal CRM
- **Multi-account WeChat Work** — enterprise feature
- **Git-backed workspace** (Twenty's thing) — interesting but overkill
- **Logic functions / code interpreter** — security surface, no PRM use case
- **Encrypted backups with PBKDF2** — sync already provides backup
- **App disguised as calculator** — paranoia feature

## Recommended next-batch (3 S-cost items)

**Sprint 1 — "Smarter reminders"** (weavine already has the data):

1. **Relationship health score** — add `health_score` computed column on `contact` (formula: `importance_weight × exp(-days_since_last_interaction / tier_halflife)`). Surface as colored dot on contact list. ~3 days.
2. **Keep-in-touch reminders** — add `keep_in_touch_cadence_days` column (per-importance default: high=30, medium=90, low=180). Auto-schedule reminder if no interaction within cadence. ~3 days.
3. **Daily digest** — new route `/digest` that aggregates: due reminders + going-cold contacts + today's events + Dex-Shuffle-style serendipity pick. ~3 days.

Total: ~9 working days, zero new infrastructure. Testable end-to-end before any LLM work.

**Sprint 2 — "Voice → structured"** (builds on existing voice):

1. **Voice-to-CRM notes** — extend existing ASR pipeline to call LLM with structured output (extract: contact refs, action items, follow-up date). Save to `interaction` table. ~5 days.

**Sprint 3 — "Chat your CRM"**:

1. **MCP server** — `POST /mcp` endpoint with 8 tools (search/get/create contact, log note, set reminder, list recent, get digest). Auth via existing JWT. ~2 weeks.

## Why this order

1. **Sprint 1 = zero new infrastructure.** Pure UX on existing data. Validates "relationship intelligence" UX with users before investing in AI infra.
2. **Sprint 2 = first LLM integration.** If users love the AI extraction in notes, the case for full MCP server is unblocked.
3. **Sprint 3 = strategic position.** MCP server makes weavine the desktop CRM you can talk to from Claude Code / Cursor / ChatGPT — a moat that cloud CRMs can't easily replicate (desktop data + cloud MCP = best of both).

## Open questions for user

- [ ] Confirm relationship health score formula (see formula in Sprint 1.1)
- [ ] Confirm cadence defaults (30/90/180?)
- [ ] MCP server: read-only first or read+write from day 1?
- [ ] Any features in "Skip" list that should actually be priority?

## References

Librarian session IDs (preserve context for follow-up):
- bg_de9894ff (Clay/Folk/Dex/Covve scan)
- bg_f6016233 (OSS niche: Monica, Twenty, Bonds, PingCRM, Mob, Noted, Kindred, …)
- bg_7445ea92 (AI wave + Chinese SCRM landscape)