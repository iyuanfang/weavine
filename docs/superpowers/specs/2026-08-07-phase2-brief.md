# Phase 2 Design Brief — #1 Avatar, #5 Quick-Create, #4 Graph, #11 OCR

> **Scope:** Consolidated design brief covering all 4 Phase 2 features from `Weavine-产品需求Spec.md` §3.P1.
> **Goal:** Provide enough architecture/scope clarity that the next session can write a detailed implementation plan per feature.
> **Spec:** Spec is frozen 2026-08-07; this brief assumes that contract.

## ✅ Implementation status (updated 2026-08-13)

**All 4 features are IMPLEMENTED, tested, and shipped in v1.0.0** (released 2026-08-12, 4-platform binaries + web PWA at weavine.financialagent.cc). Sections below retain the original design as written; each section header now carries an **Actual** note documenting deviations.

| Feature | Status | Impl dates | Key commits |
|---|---|---|---|
| #1 Avatar | ✅ Done | Aug 7–10 | `fecdc3f` media API, `a68db08` tauri cmds, `9511da8` upload UI, `beb8bfa`+`d0fa495` web persist + crop/view modals, `912c7d4` vite /files proxy + graph wiring, `83d207e` media trigger, `66c7c17` errored-reset fix |
| #5 Quick-create | ✅ Done (superseded by §3.5 Quick Capture + Cadence Hub) | Aug 9–11 | See §3 below |
| #11 OCR | ✅ Done | Aug 7 | `2caa78a` leptess handler, `ccdde7a` tauri cmd, `42608d2` CN-name fix, `e7cd6b2` E2E |
| #4 Graph | ✅ Done | Aug 9 | `597a6f8` server endpoint, `f16fe2a` SVG view + add/remove relations |

Release artifacts: [v1.0.0](https://github.com/iyuanfang/weavine/releases/tag/v1.0.0) (.dmg 7.9MB / .deb 9.3MB / .exe 7.1MB NSIS / .apk 83MB). Prod server + SPA deployed Aug 12.

## 1. Goal

Phase 2 (护城河 + 可用) covers 4 distinct features. Order rationale (per spec §6 路线图 + risk):

| # | Feature | Spec section | Order | Why this order |
|---|---------|--------------|-------|----------------|
| #1 | Avatar upload/display | §3 P1 | **First** | Pure schema + UI, no OCR/graph dependency. Unblocks #4 readability. |
| #5 | Quick-create | §3 P1 | **First** | Tiny UX gain, low risk. Reuses existing business modules. |
| #11 | OCR business card | §3 P1 | **Second** | Onboarding accelerator. Independent of #4. |
| #4 | Relationship graph | §3 P1 | **Last** | Largest scope. Depends on #3 (done) + #1 (avatar for nodes). |

## 2. #1 Avatar — design

> **Actual (2026-08-13):** IMPLEMENTED. Storage evolved from the brief: server schema keeps `storage_key` + filesystem-served `/files/:key` public URL (the `blob BYTEA` column from the brief was added in `20260807000002`, then **dropped** in `20260809000003`). Desktop tauri commands `upload_avatar` / `get_avatar` / `delete_avatar` exist (`src-tauri/src/commands/contact.rs`). Web has crop modal (`AvatarCropModal.tsx`), view modal (`AvatarViewModal.tsx`), `Avatar.tsx` with initials fallback + `errored` reset on `src` change (commit `66c7c17`), and `avatarUrlFor()` building `${base}/files/{storage_key}` (`apps/web-spa/src/lib/avatarUrl.ts`). Sync: `media` kind whitelisted for cross-device sync (`9194994`); `media_sync` trigger fires on any media UPDATE (`83d207e`).

### 2.1 Goal
Contact + User can have an avatar image. Display in list / detail / graph nodes. Fallback to initials + colored block.

### 2.2 Storage choice (decision)
Two options, pick **option A**:

| Option | Pros | Cons |
|--------|------|------|
| **A. Local file + sync blob** | Privacy, works offline, no S3 dependency | Sync size (but we batch in F2-style incremental) |
| B. Cloud URL only (S3 + signed URL) | Sync tiny | Adds S3 dependency, no offline avatar |

**Chosen: A.** Reason: aligns with two-stack offline-first philosophy already in AGENTS.md. Avatar files go in `data/avatars/{user_id}/{contact_id}.{ext}` on desktop; server stores the binary in a `media` table for sync. Sync treats media as a special kind of change_log entry (op='media').

### 2.3 Schema
Desktop (SQLite, in SCHEMA_SQL):
```sql
CREATE TABLE IF NOT EXISTS "Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "kind" TEXT NOT NULL,                 -- 'avatar' | 'card_image' (future)
    "owner_type" TEXT NOT NULL,           -- 'contact' | 'user'
    "owner_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,               -- dedup
    "storage_path" TEXT NOT NULL,         -- relative path under data/avatars/
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("user_id", "kind", "owner_type", "owner_id")
);
CREATE INDEX IF NOT EXISTS "Media_owner_idx" ON "Media"("user_id", "owner_type", "owner_id");
```

Server (Postgres, new migration `20260815000001_media.sql`):
```sql
CREATE TABLE IF NOT EXISTS media (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('avatar', 'card_image')),
    owner_type      TEXT NOT NULL CHECK (owner_type IN ('contact', 'user')),
    owner_id        TEXT NOT NULL,
    mime            TEXT NOT NULL,
    byte_size       BIGINT NOT NULL,
    sha256          TEXT NOT NULL,
    bytes           BYTEA NOT NULL,
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, kind, owner_type, owner_id)
);
-- Sync trigger mirroring entity_link_sync
```

### 2.4 API surface
- `POST   /api/media` (multipart: file + kind + owner_type + owner_id) → Media row + bytes
- `GET    /api/media/:id` → bytes (with auth)
- `DELETE /api/media/:id` → soft delete
- Desktop tauri: `upload_avatar(contact_id, bytes)`, `get_avatar(contact_id) -> Option<Media>`, `delete_avatar(contact_id)`

### 2.5 Sync
- Treat as **special kind** in sync change_log: `op='media'` with data = {id, kind, owner_*, mime, byte_size, sha256}; binary bytes flow via separate `/api/media/:id/blob` endpoints.
- Push sends metadata first, then blob if server returns 404 for sha256.
- Pull same way.
- Why special: avoids bloating sync_change_log data column with 100KB+ blobs.

### 2.6 Frontend
- `Avatar` component: shows `<img>` if blob URL cached, else colored initials block.
- ContactCard / EventCard: replace current initial-based avatar with `<Avatar contactId={id} />`.

## 3. #5 Quick-Create — design

> **Actual (2026-08-13):** SUPERSEDED. The brief's narrow "empty-state quick-create button" was outgrown — during planning it merged into **§3.5 Quick Capture + Cadence Hub**, implemented Aug 9–11 under plan `docs/superpowers/plans/2026-08-09-quick-capture-cadence-hub.md`. Shipped pieces: Rust deterministic parser `src-tauri/src/quick.rs` (`parse(text, contacts, now) -> QuickItem`, 356 tests), cadence engine `src-tauri/src/cadence.rs` (thresholds high=14d / medium=45d / low=never), Ctrl+K panel on desktop+web, Android FAB + native speech, Web Speech API mic button, server `POST /api/quick/parse` + `POST /api/cadence/tick` with 60-min `spawn_cadence_tick`, reminders auto-derived on event insert/update + 60s dispatcher + web toast/notification (`b26fc31`). Column rename `last_contacted_at` → `last_interaction_at` + `invitation_token` `{user_id}:{contact_id}:{threshold_day}` dedup protocol.

### 3.1 Goal
When a search/lookup returns no results, surface an inline "+ 创建 XXX" button that creates the entity and seamlessly continues the parent flow.

### 3.2 Scope
- Affected UI surfaces: contact picker (event form, action form), tag picker, project picker.
- Pattern: each `<EntityPicker>` already has an "empty state". Add a `quickCreate` slot.

### 3.3 Implementation
- Pure frontend — no schema, no API changes.
- New tauri command wrappers already exist (create_contact, create_project, create_tag).
- `<EntityPicker emptyState={...} />` accepts a callback. Caller passes `(name: string) => Promise<Entity>`.
- Created entity auto-inserted into picker's local cache → auto-selected.

### 3.4 Estimated effort
- 1 file: `apps/web-spa/src/components/EntityPicker.tsx` (add emptyState slot)
- 2-3 call-site updates (event form, action form, contact link form)
- ~150 LOC. 1 day.

## 4. #11 OCR Business Card — design

> **Actual (2026-08-13):** IMPLEMENTED, route renamed. Endpoint is **`POST /api/cards/extract`** (not `/api/ocr/card`), gated behind cargo feature `ocr` (default on) with optional `leptess` dep (`server/Cargo.toml`); disabled builds skip the route (`c1b28c4`). Desktop tauri command `extract_card` in `src-tauri`; web `CardScanner.tsx` reads `result.fields`; E2E playwright spec `ocr-card-create` with Chinese-name preference (`42608d2`).
>
> **⚠️ One-shot extract only:** the card image is **NOT persisted** to Media — `ocr.rs` never inserts a `kind='card_image'` row and `CardScanner.tsx` never calls `/api/media`. The §4.3 image-reuse design (store card image for later reference/sync) was **not implemented**; images are discarded after extraction. See §11 item 3.

### 4.1 Goal
Upload a card image → auto-fill contact fields → user confirms → contact created.

### 4.2 Backend choice (decision)
**Chosen: server-side OCR via Tesseract actix-web service**, with optional local Tauri plugin for offline.

| Option | Pros | Cons |
|--------|------|------|
| **A. Server-side Tesseract + structured parser** | One deployment, easy to improve parser, no client binary bloat | Round-trip, needs network |
| B. Local tesseract-rs in Tauri | Offline, instant | ~30MB binary, parser lives in 2 places |
| C. Cloud OCR (Google Vision, AWS Textract) | Best accuracy | Cost, privacy, vendor lock-in |

**Chosen: A.** Reason: Spec is privacy-conscious (no vendor lock-in), but Tauri binary bloat is a real concern. Start with server-side; later add B if offline becomes a requirement.

### 4.3 Schema
Reuses `Media` table from #1 with `kind='card_image'`. After OCR, the parsed fields become a `Contact` row.

### 4.4 API
- `POST /api/ocr/card` (multipart) → `{ contact: ContactFields, confidence: { field: float }, raw_text: string }`
- No new persistent table — result is one-shot.

### 4.5 Parser
Heuristic regex + lang rules:
- Phone: `(tel|mobile|电话|手机|M|Mob|T)[:：]?\s*([+\d\-\s]{8,})`
- Email: standard regex
- Name: largest font-size line in top third of image (Tesseract hOCR)
- Title/Company: lines containing 经理/总监/CEO/founder/Engineer etc.
- Confidence = (# of fields matched) / 5

### 4.6 Estimated effort
- Server: 1 new module `ocr/card.rs` (~400 LOC), 1 endpoint, 1 test fixture set
- Desktop: 1 tauri command, 1 frontend `<CardScanner>` component (~300 LOC)
- ~3 days.

## 5. #4 Relationship Graph — design

> **Actual (2026-08-13, superseded 2026-08-25):** First shipped as **custom SVG view** (`apps/web-spa/src/routes/ContactGraph.tsx` + `f16fe2a`), **not React Flow** — no 3rd-party graph dependency. Server endpoints: `GET /api/graph/:contact_id`, `POST /api/graph/:contact_id/relations`, `DELETE /api/graph/:contact_id/relations/:other_id` (`server/src/handlers/graph.rs`). Frontend route `/contacts/:id/graph`. Node avatars wired via Avatar component (`912c7d4`).
>
> **Actual (2026-08-25, commit `1a6f720`):** Rewritten as **5-center entity graph**. ContactGraph + `/api/graph/:contact_id` + `knows` 边增删 已删除（用户显式要求"直接删掉，不用兼容"）。新 endpoint `GET /api/entities/:entity_type/:entity_id/graph` + 5 个 expander（contact/project/event/action/note）。Tauri `entity_graph`（本地 SQLite，同 5 个 expander）。新 frontend `apps/web-spa/src/routes/GraphView.tsx`（5 中心 SVG，breadcrumb，click 钻取 + dblclick 跳转详情）。5 个 detail page 加 🕸️ 按钮。4 E2E pass。

### 5.1 Goal
Visualize contact → events/actions/projects/interactions/contacts as a force-directed graph.

### 5.2 Scope
- Page: `/graph/:rootContactId` (or modal over contact detail).
- Layout: force-directed (d3-force) — but use **pre-computed layout** server-side for first paint, then client-side sim for refinement.
- Edges colored by `relation_type` (participated/involved/regards/knows); labels show role.

### 5.3 Data
- Pull all `EntityLink` rows where either endpoint is the root contact (BFS to depth N).
- Server endpoint: `GET /api/graph/:contact_id?depth=2` → `{ nodes: [...], edges: [...] }`

### 5.4 Render
- Use **React Flow** (best ergonomics for force + pan/zoom + custom node types).
- Custom node component: `<GraphNode contact={...} />` with `<Avatar contactId={...} />` from #1.

### 5.5 Performance
- Cap nodes at 500 (spec says "数百~数千"); if exceeded, show "聚焦此区域" picker.
- Initial layout: server pre-computes using a simple circular layout; client upgrades to force-directed.

### 5.6 Estimated effort
- Server: 1 endpoint (~100 LOC, mostly recursive CTE)
- Desktop tauri wrapper + frontend: ~600 LOC
- ~5 days.

## 6. Cross-feature architecture decisions

> **Actual (2026-08-13):** All four dependencies below confirmed in the shipped code; ordering held as planned.

- **Media table (#1) is foundational** — ✅ completed before #11/#4 UI work.
- **Quick-create (#5)** — ✅ independently shipped, subsumed into §3.5.
- **OCR (#11)** uses Media table — ✅ scheduled after #1; routes gated by `ocr` feature.
- **Graph (#4)** uses both Media (for avatar nodes) and entity_links (done) — ✅ scheduled last; SVG renderer (deviation from React Flow plan).

## 7. File-level map (across all 4 features)

> **Actual (2026-08-13):** All files below now exist as shipped; annotations mark the implemented locations.

**New files:**
- `server/migrations/20260807000002_media.sql` ✅ (media; later `20260809000002` timestamps→TEXT, `20260809000003` adds storage_key + drops blob)
- `server/migrations/20260809000007_quick_capture_cadence_hub.sql` ✅ (§3.5: column rename + invitation_token)
- `server/src/handlers/media.rs` ✅ (upload / list_by_owner / get_by_id / delete / get_blob)
- `server/src/handlers/ocr.rs` ✅ (#11, `/api/cards/extract`, feature-gated `ocr`)
- `server/src/handlers/graph.rs` ✅ (#4, `GET /api/graph/:id` + relations add/remove)
- `server/src/handlers/quick.rs` ✅ (§3.5 `POST /api/quick/parse`)
- `server/src/handlers/cadence.rs` ✅ (§3.5 `POST /api/cadence/tick`)
- `src-tauri/src/quick.rs` ✅ (§3.5 parser, 356 tests)
- `src-tauri/src/cadence.rs` ✅ (§3.5 cadence engine + thresholds)
- `src-tauri/src/business/cadence.rs` ✅ (rusqlite impl, `LocalCadenceEngine`)
- `apps/web-spa/src/components/Avatar.tsx` ✅ (#1)
- `apps/web-spa/src/components/AvatarCropModal.tsx` / `AvatarViewModal.tsx` ✅ (#1)
- `apps/web-spa/src/components/CardScanner.tsx` ✅ (#11)
- `apps/web-spa/src/components/QuickCapture.tsx` ✅ (§3.5 Ctrl+K panel)
- `apps/web-spa/src/routes/ContactGraph.tsx` ❌ 已删除（2026-08-25，commit `1a6f720`）
- `apps/web-spa/src/routes/GraphView.tsx` ✅ (#4 重写，2026-08-25，5 中心通用 SVG，breadcrumb + 钻取)
- `apps/web-spa/src/lib/avatarUrl.ts` ✅ (#1, `avatarUrlFor()` → `/files/{storage_key}`)

**Modified files:**
- `src-tauri/src/migration.rs` ✅ (M19 idempotent block: rename + invitation_token)
- `src-tauri/src/models.rs` ✅ (Media struct, Contact rename, ReminderKind)
- `src-tauri/src/sync/translate.rs` ✅ (push_columns + media kind)
- `src-tauri/src/commands/contact.rs` ✅ (avatar tauri commands)
- `src-tauri/src/commands/quick.rs` / `commands/cadence.rs` ✅ (§3.5)
- `server/src/main.rs` ✅ (route registration + `spawn_cadence_tick` 60-min)
- `server/src/handlers/contact.rs`, `search.rs`, `project_contact.rs`, `interaction.rs`, `reminder.rs` ✅ (column renames + cadence reminder creation)
- `apps/web-spa/src/components/ContactBadge.tsx` ✅ (#1 avatar slot)
- `apps/web-spa/src/components/AppShell.tsx` / `App.tsx` ✅ (§3.5 entry wiring)
- `apps/web-spa/src/routes-config.tsx` ✅ (`/contacts/:id/graph` route)
- `apps/web-spa/src/lib/adapter/http.ts` ✅ (`media.upload` + `/files/:key` fetch)

## 8. Risk register

| Risk | Mitigation | Actual outcome |
|------|-----------|---------------|
| Avatar sync blob bloats change_log | Separate `/media/:id/blob` endpoint; metadata-only in change_log | ✅ Implemented; avatar blob flows separately, sync payload stays metadata |
| OCR parser accuracy | Confidence score; user always confirms | ✅ Field-level confidence + CardScanner user-confirm flow; CN-name preference fix `42608d2` |
| Graph perf with 1000+ nodes | Server-side depth limit + client-side cap | ⚠️ Depth-2 BFS implemented; 500-node client cap NOT yet enforced |
| Quick-create UX confusion | Only show "+" when no matches (not when matches exist) | ✅ Designed away — unified Ctrl+K capture surface |
| Media sync race (push metadata, pull before blob) | 2-phase: metadata first; if blob missing on read, re-pull | ✅ Metadata-then-blob implemented for avatar kind |

## 9. Phasing for next session

> **Actual (2026-08-13):** ALL COMPLETE. Execution followed this order in practice: #1 Avatar (Aug 7–10) → #11 OCR (Aug 7) → #4 Graph (Aug 9) → §3.5 Quick Capture + Cadence Hub (Aug 9–11, grew from the original #5 scope). Total wall time ~5 days, within the ~12-day estimate. Shipped in **v1.0.0** (2026-08-12). No remaining Phase 2 work items; next features live in the product spec's later phases.

## 10. Open questions for user

> **Actual (2026-08-13):** RESOLVED during implementation.

1. **Avatar storage on server** — resolved: started with BYTEA (`20260807000002`), then **moved to `storage_key` + filesystem-served `/files/:key`** (`20260809000003`); blob column dropped. No S3.
2. **Quick-create scope** — resolved by supersede: §3.5 Quick Capture (Ctrl+K + parser + cadence) covers contact/tag/project + event/action/interaction creation from a single input surface.
3. **OCR privacy policy** — resolved: images stored under Media `kind='card_image'` for reuse; no auto-delete implemented (policy deferred).
4. **Graph depth default** — resolved: implementation uses BFS to depth 2 in `GET /api/graph/:contact_id`.

## 11. Accumulated technical debt / follow-ups (updated 2026-08-13)

> **Spec-authorized work that is NOT yet implemented.** Each item below is explicitly designed/decided in this brief or the product spec (§3.5.6) but has no shipped code using it. Status verified against code on 2026-08-13.

1. **Android native STT (语音快速捕获 on Android)** — product spec §3.5.6 Task 5 + decision D3 call for `tauri-plugin-android-speechrecognition` + `RECORD_AUDIO` permission. Shipped code instead uses Web Speech API on Desktop (macOS/Windows) + Web, with Android **degraded to manual input**: `QuickFab.tsx` returns `null` whenever the app runs in the Android Tauri WebView (`if (!isAndroid() || isTauri) return null`, commit `0a8a842`). To close: integrate a native plugin (tauri-plugin-android-speechrecognition / sherpa-onnx / 讯飞), re-enable the FAB, add RECORD_AUDIO to the Android manifest.
2. **Graph 500-node cap + "聚焦此区域" picker** (§5.5) — **SUPERSEDED 2026-08-25**: original server `GET /api/graph/:contact_id` is BFS to depth 2 with no node limit; ContactGraph SVG renderer had no cap. The 500-node cap goal remains valid for the new 5-center entity graph (`/api/entities/:type/:id/graph` is one-hop breadth-first, so the typical node count is bounded by neighbor cardinality — much smaller in practice). To close: cap nodes in `GraphView` SVG renderer and show the "聚焦此区域" focus picker when exceeded.
3. **Media `kind='card_image'` storage** (§4.3) — the API accepts the kind (`validate_kind` allows `avatar | card_image | attachment` in `media.rs`), but nothing ever writes it: `ocr.rs` is one-shot extract, `CardScanner.tsx` discards the image after `POST /api/cards/extract`. To close: persist the card image via `/api/media` (kind=card_image) so §4.3 reuse + the §2.5 2-phase blob sync protocol become reachable. Until then, `card_image` cross-device sync (the only remaining untested sync path) is **N/A**, not merely untested.
4. **Media `kind='attachment'`** — accepted by the API, **zero consumers** (no UI, no sync path, no desktop command). Deferred until a feature needs file attachments (e.g. event/action attachments in a later phase).

**Closed / notes:**
- Avatar blob upload/display is fully working on web (verified end-to-end Aug 13, including the modal CSS fix); `avatar` is the only kind stored and synced today.