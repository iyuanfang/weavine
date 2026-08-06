# Phase 2 Design Brief — #1 Avatar, #5 Quick-Create, #4 Graph, #11 OCR

> **Scope:** Consolidated design brief covering all 4 Phase 2 features from `Weavine-产品需求Spec.md` §3.P1.
> **Goal:** Provide enough architecture/scope clarity that the next session can write a detailed implementation plan per feature.
> **Spec:** Spec is frozen 2026-08-07; this brief assumes that contract.

## 1. Goal

Phase 2 (护城河 + 可用) covers 4 distinct features. Order rationale (per spec §6 路线图 + risk):

| # | Feature | Spec section | Order | Why this order |
|---|---------|--------------|-------|----------------|
| #1 | Avatar upload/display | §3 P1 | **First** | Pure schema + UI, no OCR/graph dependency. Unblocks #4 readability. |
| #5 | Quick-create | §3 P1 | **First** | Tiny UX gain, low risk. Reuses existing business modules. |
| #11 | OCR business card | §3 P1 | **Second** | Onboarding accelerator. Independent of #4. |
| #4 | Relationship graph | §3 P1 | **Last** | Largest scope. Depends on #3 (done) + #1 (avatar for nodes). |

## 2. #1 Avatar — design

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

- **Media table (#1) is foundational** — completes before any UI work on #4 or #11.
- **Quick-create (#5)** is independent and can ship any time after the relevant pickers exist.
- **OCR (#11)** uses Media table — schedule after #1.
- **Graph (#4)** uses both Media (for avatar nodes) and entity_links (done) — schedule last.

## 7. File-level map (across all 4 features)

**New files:**
- `server/migrations/20260815000001_media.sql`
- `server/src/handlers/media.rs`
- `server/src/handlers/ocr.rs` (if #11)
- `server/src/handlers/graph.rs` (if #4)
- `server/src/business/ocr.rs` (if #11)
- `apps/web-spa/src/components/Avatar.tsx` (#1)
- `apps/web-spa/src/components/EntityPicker.tsx` (#5, may already exist)
- `apps/web-spa/src/components/CardScanner.tsx` (#11)
- `apps/web-spa/src/components/GraphView.tsx` (#4)

**Modified files:**
- `src-tauri/src/migration.rs` (add Media rebuild! + SCHEMA_SQL)
- `src-tauri/src/models.rs` (add Media struct)
- `src-tauri/src/sync/translate.rs` (add 'media' kind)
- `src-tauri/src/sync/mod.rs` (media push/pull handling)
- `src-tauri/src/commands/contact.rs` (avatar tauri commands)
- `server/src/main.rs` (route registration)
- `apps/web-spa/src/components/ContactCard.tsx` (use Avatar)
- `apps/web-spa/src/components/EventCard.tsx` (use Avatar + chip UI from #3)

## 8. Risk register

| Risk | Mitigation |
|------|-----------|
| Avatar sync blob bloats change_log | Separate `/media/:id/blob` endpoint; metadata-only in change_log |
| OCR parser accuracy | Confidence score; user always confirms |
| Graph perf with 1000+ nodes | Server-side depth limit + client-side cap |
| Quick-create UX confusion | Only show "+" when no matches (not when matches exist) |
| Media sync race (push metadata, pull before blob) | 2-phase: metadata first; if blob missing on read, re-pull |

## 9. Phasing for next session

Recommended execution order (each as its own plan):

1. **#1 Avatar plan** — media table, tauri commands, Avatar component (no frontend integration yet). ~3 days.
2. **#5 Quick-create plan** — frontend-only EntityPicker slot. ~1 day.
3. **#11 OCR plan** — depends on #1 (Media). Server OCR endpoint + CardScanner UI. ~3 days.
4. **#4 Graph plan** — depends on #1 (Avatar) + #3 (entity_links). Server graph query + React Flow page. ~5 days.

Total: ~12 days for full Phase 2.

## 10. Open questions for user

1. **Avatar storage on server**: keep blobs in Postgres `BYTEA` column, or switch to S3-style external storage later? (Recommend start with BYTEA, swap later.)
2. **Quick-create scope**: which pickers get the treatment in v1? Contact, tag, project — yes; action, event, interaction — confirm?
3. **OCR privacy policy**: do we keep raw images after extraction, or delete after contact created? (Recommend delete, but spec doesn't say.)
4. **Graph depth default**: 2 hops? 3? (Spec says "数百节点", so 2 is safer.)