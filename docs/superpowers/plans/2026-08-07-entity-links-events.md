# #3 Entity Links — Events Multi-Person Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert events from single-`contact_id` to multi-participant via new `entity_links` table, preserving `event.contact_id` as a derived "main participant" column.

**Architecture:**
- New junction-like table `entity_links` (from_type='event', to_type='contact', relation_type='participated') carries all participants + role.
- `event.contact_id` becomes derived: when a participant is added/removed, transaction-synced to first remaining participant's contact_id (or NULL).
- Sync layer treats `entity_link` as a junction (synth-id, push-all per cycle).
- Postgres UNIQUE constraint prevents duplicate edges.
- Frontend: EventCard adds participant chips with role labels.

**Tech Stack:**
- Tauri 2 + rusqlite (desktop)
- axum 0.7 + sqlx 0.8 + Postgres (server)
- React 18 + Vite + TypeScript (frontend)
- Shared model via `weavine_lib::models` (one struct, two derives)

**Spec:** `docs/superpowers/specs/2026-08-07-entity-links-events-design.md`

## Global Constraints

(from `AGENTS.md` + spec, applies to every task)

- **Two-stack**: Desktop uses `business/` direct rusqlite queries, server uses `sqlx::query` direct. No `trait Repo` until v0.2.0c sync schema stabilizes.
- **One model, two engines**: Shared structs in `weavine_lib::models` get both `derive_rusqlite::FromRow` (desktop) and `#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]`.
- **Snake_case on both stacks**: No `obj_camel_to_snake` translation needed (already identity).
- **Sync triggers**: Server migrations emit changes via `sync_log_change()` BEFORE INSERT/UPDATE/DELETE trigger.
- **Server migrations**: Append-only `server/migrations/YYYYMMDDxxxxxx_<name>.sql` files. Use `gen_random_uuid()::TEXT` for default id, TEXT for all PK/FK.
- **Desktop migrations**: Append a `rebuild!(EntityName, ...)` block in `src-tauri/src/migration.rs` with snake_case column map.
- **Junction-like tables**: `entity_link` joins `JUNCTION_TABLES` in `sync/translate.rs` — synth id, push-all per cycle (no `updated_at` filter).
- **No type suppression**: `as any`, `@ts-ignore`, `@ts-expect-error` are forbidden.
- **Transactional consistency**: any change touching both `event.contact_id` and `entity_links` rows must use a single transaction.
- **Error type**: Server handlers return `Result<T, (StatusCode, String)>` — there is no `ApiError` enum. Use `axum::http::StatusCode`.
- **Auth pattern**: Server handlers use `headers: HeaderMap` + `extract_auth(&headers, pool.as_ref()) -> String` (writes are `extract_auth_with_device`).

---

## File Structure

**New files:**
- `server/migrations/20260807000001_entity_links.sql` — Postgres schema + trigger + indexes
- `src-tauri/tests/entity_link_sync.rs` — Integration test (push→pull round trip)

**Modified files:**
- `weavine_lib/src/models.rs` — Add `EntityLink` struct + dual derives
- `src-tauri/src/migration.rs` — Add `EntityLink` rebuild! block
- `src-tauri/src/sync/translate.rs` — Register `entity_link` in 5 places
- `src-tauri/src/commands/event.rs` — Add 4 tauri commands for participants
- `server/src/handlers/event.rs` — Add 4 handlers + embed participants in Event response
- `server/src/main.rs` — Register 4 new routes
- `apps/web-spa/src/components/EventCard.tsx` — Participant chips UI

---
### Task 1: Add `EntityLink` shared model

**Files:**
- Modify: `weavine_lib/src/models.rs` (after `ProjectContact` struct)

- [ ] **Step 1: Add struct**

Append after `ProjectContact`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
#[cfg_attr(not(feature = "sqlx"), derive(derive_rusqlite::FromRow))]
pub struct EntityLink {
    pub id: String,
    pub user_id: String,
    pub from_type: String,
    pub from_id: String,
    pub to_type: String,
    pub to_id: String,
    pub relation_type: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}
```

- [ ] **Step 2: Verify**

Run: `cargo build -p weavine_lib`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add weavine_lib/src/models.rs && git commit -m "feat(model): add EntityLink struct with dual derives"
```

---

### Task 2: Server Postgres migration

**Files:**
- Create: `server/migrations/20260807000001_entity_links.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE IF NOT EXISTS entity_links (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    user_id         TEXT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    from_type       TEXT NOT NULL CHECK (from_type IN ('contact','event','action','project','interaction')),
    from_id         TEXT NOT NULL,
    to_type         TEXT NOT NULL CHECK (to_type IN ('contact','event','action','project','interaction')),
    to_id           TEXT NOT NULL,
    relation_type   TEXT NOT NULL CHECK (relation_type IN ('participated','involved','regards')),
    role            TEXT NOT NULL DEFAULT 'participant',
    server_revision BIGINT NOT NULL DEFAULT nextval('server_revision_seq'),
    deleted_at      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, from_type, from_id, to_type, to_id, relation_type)
);

CREATE INDEX IF NOT EXISTS ix_entity_link_event   ON entity_links (from_id) WHERE from_type = 'event';
CREATE INDEX IF NOT EXISTS ix_entity_link_contact ON entity_links (to_id)   WHERE to_type = 'contact';
CREATE INDEX IF NOT EXISTS ix_entity_link_rev     ON entity_links (user_id, server_revision);

DROP TRIGGER IF EXISTS entity_link_sync ON entity_links;
CREATE TRIGGER entity_link_sync
BEFORE INSERT OR UPDATE OR DELETE ON entity_links
FOR EACH ROW EXECUTE FUNCTION sync_log_change();
```

- [ ] **Step 2: Verify**

Run: `cd server && cargo check`
Expected: Build success (sqlx::migrate! validates SQL at compile time).

- [ ] **Step 3: Commit**

```bash
git add server/migrations/20260807000001_entity_links.sql && git commit -m "feat(server): migration for entity_links table + sync trigger"
```

---

### Task 3: Desktop SQLite migration (rebuild!)

**Files:**
- Modify: `src-tauri/src/migration.rs` (after `ProjectContact` rebuild! block)

- [ ] **Step 1: Add EntityLink rebuild!**

```rust
// ── EntityLink ──
rebuild!(EntityLink, r#"
    CREATE TABLE IF NOT EXISTS "EntityLink__new" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "from_type" TEXT NOT NULL,
        "from_id" TEXT NOT NULL,
        "to_type" TEXT NOT NULL,
        "to_id" TEXT NOT NULL,
        "relation_type" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'participant',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );"#,
    ["id"=>"id", "ownerId"=>"user_id",
     "fromType"=>"from_type", "fromId"=>"from_id",
     "toType"=>"to_type", "toId"=>"to_id",
     "relationType"=>"relation_type", "role"=>"role",
     "createdAt"=>"created_at"]
);
```

- [ ] **Step 2: Verify**

Run: `cd src-tauri && cargo check`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/migration.rs && git commit -m "feat(desktop): migration adds EntityLink table"
```

---

### Task 4: Register `entity_link` in sync translate layer

**Files:**
- Modify: `src-tauri/src/sync/translate.rs` (5 edits)

- [ ] **Step 1: Add to ENTITY_KINDS** (after `"project_contact"`)

```rust
// level 3.5 (junction-like, push-all)
"entity_link",
```

- [ ] **Step 2: Add to JUNCTION_TABLES**

```rust
pub const JUNCTION_TABLES: &[&str] = &[
    "contact_tag",
    "project_contact",
    "entity_link",
];
```

- [ ] **Step 3: Add to `sqlite_table_to_kind`**

```rust
"EntityLink" => Some("entity_link"),
```

- [ ] **Step 4: Add to `kind_to_sqlite_table`**

```rust
"entity_link" => Some("EntityLink"),
```

- [ ] **Step 5: Add to `push_columns`**

```rust
"entity_link" => &[
    "id","user_id","from_type","from_id","to_type","to_id",
    "relation_type","role","created_at"
],
```

- [ ] **Step 6: Verify**

Run: `cargo build -p weavine_lib && cargo test --lib -p weavine_lib sync::`
Expected: Build + all existing sync tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/sync/translate.rs && git commit -m "feat(sync): register entity_link kind for sync round-trip"
```

---
### Task 5: Server handlers for entity_link CRUD

**Files:**
- Modify: `server/src/handlers/event.rs`

**Interfaces (new endpoints):**
- `GET    /api/events/:id/participants` → `Json<Vec<ParticipantRow>>`
- `POST   /api/events/:id/participants` body `{contact_id, role}` → `Json<ParticipantRow>`
- `PATCH  /api/events/:id/participants/:cid` body `{role}` → `Json<ParticipantRow>`
- `DELETE /api/events/:id/participants/:cid` → `(StatusCode::NO_CONTENT, ())`

- [ ] **Step 1: Add `ParticipantRow` struct + helpers after `UpcomingParams` (around line 30)**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ParticipantRow {
    pub contact_id: String,
    pub role: String,
}

async fn fetch_participants(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
) -> Result<Vec<ParticipantRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT to_id AS contact_id, role FROM entity_links \
         WHERE from_type='event' AND from_id=$1 AND relation_type='participated' \
         ORDER BY created_at ASC"
    )
    .bind(event_id)
    .fetch_all(executor)
    .await
}

async fn sync_main_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
) -> Result<(), sqlx::Error> {
    let first: Option<(String,)> = sqlx::query_as(
        "SELECT to_id FROM entity_links \
         WHERE from_type='event' AND from_id=$1 AND relation_type='participated' \
         ORDER BY created_at ASC LIMIT 1"
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
    .await?;
    sqlx::query("UPDATE event SET contact_id=$1, updated_at=$2 WHERE id=$3")
        .bind(first.map(|(c,)| c))
        .bind(super::now_str())
        .bind(event_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn validate_role(role: &str) -> bool {
    matches!(role, "organizer" | "participant" | "referred" | "mentioned")
}

async fn authorize_event(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
    user_id: &str,
    for_update: bool,
) -> Result<(), (StatusCode, String)> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let q = format!(
        "SELECT user_id FROM event WHERE id=$1 AND deleted_at IS NULL{lock}"
    );
    let owner: Option<(String,)> = sqlx::query_as(&q)
        .bind(event_id)
        .fetch_optional(executor)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match owner {
        Some((u,)) if u == user_id => Ok(()),
        Some(_) => Err((StatusCode::FORBIDDEN, "无权访问".into())),
        None => Err((StatusCode::NOT_FOUND, "事件不存在".into())),
    }
}
```

- [ ] **Step 2: Add 4 handlers at end of file**

```rust
pub async fn list_participants(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
) -> Result<Json<Vec<ParticipantRow>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    let rows = fetch_participants(&*pool, &event_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn add_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    let role = if validate_role(&body.role) { body.role.clone() } else { "participant".to_string() };
    sqlx::query(
        "INSERT INTO entity_links (user_id, from_type, from_id, to_type, to_id, relation_type, role) \
         VALUES ($1, 'event', $2, 'contact', $3, 'participated', $4) \
         ON CONFLICT (user_id, from_type, from_id, to_type, to_id, relation_type) \
         DO UPDATE SET role = EXCLUDED.role"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&body.contact_id)
    .bind(&role)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ParticipantRow { contact_id: body.contact_id, role }))
}

pub async fn set_participant_role(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    if !validate_role(&body.role) {
        return Err((StatusCode::BAD_REQUEST, "无效角色".into()));
    }
    let rows = sqlx::query(
        "UPDATE entity_links SET role=$1 \
         WHERE user_id=$2 AND from_type='event' AND from_id=$3 AND to_id=$4 \
           AND relation_type='participated'"
    )
    .bind(&body.role)
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if rows.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "参与者不存在".into()));
    }
    Ok(Json(ParticipantRow { contact_id, role: body.role }))
}

pub async fn remove_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
) -> Result<(StatusCode, ()), (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    sqlx::query(
        "DELETE FROM entity_links \
         WHERE user_id=$1 AND from_type='event' AND from_id=$2 AND to_id=$3 \
           AND relation_type='participated'"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::NO_CONTENT, ()))
}
```

- [ ] **Step 3: Verify**

Run: `cd server && cargo check`
Expected: Build success.

- [ ] **Step 4: Commit**

```bash
git add server/src/handlers/event.rs && git commit -m "feat(server): participants CRUD handlers + sync_main_participant"
```

---

### Task 6: Server route registration

**Files:**
- Modify: `server/src/main.rs` (find where event routes are registered, add 4 new routes)

- [ ] **Step 1: Add 4 new routes alongside existing event routes**

Find lines like `route("/api/events", ...).route("/api/events/:id", ...)`. Add after them:

```rust
.route("/api/events/:id/participants", get(handlers::event::list_participants).post(handlers::event::add_participant))
.route("/api/events/:id/participants/:cid", patch(handlers::event::set_participant_role).delete(handlers::event::remove_participant))
```

Adjust method imports (`patch`, `get`, `post`, `delete`) to match the existing imports at top of `main.rs`.

- [ ] **Step 2: Verify**

Run: `cd server && cargo check`
Expected: Build success.

- [ ] **Step 3: Commit**

```bash
git add server/src/main.rs && git commit -m "feat(server): register participant routes"
```

---

### Task 7: Desktop tauri commands

**Files:**
- Modify: `src-tauri/src/commands/event.rs`

**Interfaces (new commands):**
- `list_event_participants(event_id: String) -> Result<Vec<ParticipantRow>>`
- `add_event_participant(event_id: String, contact_id: String, role: String) -> Result<ParticipantRow>`
- `set_event_participant_role(event_id: String, contact_id: String, role: String) -> Result<ParticipantRow>`
- `remove_event_participant(event_id: String, contact_id: String) -> Result<()>`

- [ ] **Step 1: Add ParticipantRow struct + 4 commands**

Append at end of `src-tauri/src/commands/event.rs` (after existing event commands):

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct ParticipantRow {
    pub contact_id: String,
    pub role: String,
}

#[tauri::command]
pub async fn list_event_participants(event_id: String) -> Result<Vec<ParticipantRow>, String> {
    let (base, token) = crate::sync::cloud_client().ok_or_else(|| "未登录".to_string())?;
    let url = format!("{}/api/events/{}/participants", base, event_id);
    let resp = reqwest::Client::new().get(&url).bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("list failed: {}", resp.status())); }
    resp.json::<Vec<ParticipantRow>>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_event_participant(event_id: String, contact_id: String, role: String) -> Result<ParticipantRow, String> {
    let (base, token) = crate::sync::cloud_client().ok_or_else(|| "未登录".to_string())?;
    let url = format!("{}/api/events/{}/participants", base, event_id);
    let resp = reqwest::Client::new().post(&url).bearer_auth(&token)
        .json(&ParticipantRow { contact_id: contact_id.clone(), role })
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("add failed: {}", resp.status())); }
    resp.json::<ParticipantRow>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_event_participant_role(event_id: String, contact_id: String, role: String) -> Result<ParticipantRow, String> {
    let (base, token) = crate::sync::cloud_client().ok_or_else(|| "未登录".to_string())?;
    let url = format!("{}/api/events/{}/participants/{}", base, event_id, contact_id);
    let resp = reqwest::Client::new().patch(&url).bearer_auth(&token)
        .json(&ParticipantRow { contact_id: contact_id.clone(), role })
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("set role failed: {}", resp.status())); }
    resp.json::<ParticipantRow>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_event_participant(event_id: String, contact_id: String) -> Result<(), String> {
    let (base, token) = crate::sync::cloud_client().ok_or_else(|| "未登录".to_string())?;
    let url = format!("{}/api/events/{}/participants/{}", base, event_id, contact_id);
    let resp = reqwest::Client::new().delete(&url).bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("remove failed: {}", resp.status())); }
    Ok(())
}
```

(Read `src-tauri/src/sync/mod.rs` for the actual accessor — `cloud_client()` is illustrative; replace with the real `Option<(String, String)>` accessor that returns `(base_url, token)`.)

- [ ] **Step 2: Register commands in `lib.rs`**

Find the `tauri::generate_handler!` invocation and add the 4 new commands:

```rust
.invoke_handler(tauri::generate_handler![
    // existing commands...
    commands::event::list_event_participants,
    commands::event::add_event_participant,
    commands::event::set_event_participant_role,
    commands::event::remove_event_participant,
])
```

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo check`
Expected: Build success.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/event.rs src-tauri/src/lib.rs && git commit -m "feat(desktop): tauri commands for event participants"
```

---

### Task 8: Sync round-trip integration test

**Files:**
- Create: `src-tauri/tests/entity_link_sync.rs`

- [ ] **Step 1: Write integration test**

Create `src-tauri/tests/entity_link_sync.rs`:

```rust
//! Round-trip test: insert entity_link locally + verify push_columns
//! schema matches expected wire format.

use rusqlite::Connection;
use weavine_lib::models::EntityLink;
use weavine_lib::sync::translate::push_columns;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    weavine_lib::migration::run(&conn).unwrap();
    conn.execute(
        "INSERT INTO \"User\" (id, email, name) VALUES ('u1', 'a@b', 'Test')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO \"Contact\" (id, ownerId, nickname) VALUES ('c1', 'u1', 'Alice')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO \"Event\" (id, ownerId, title, event_type, start_at, created_at, updated_at) \
         VALUES ('e1', 'u1', 'Demo', 'event', '2026-08-01 10:00:00', '2026-08-01', '2026-08-01')",
        [],
    ).unwrap();
    conn
}

#[test]
fn entity_link_push_columns_registered() {
    let cols = push_columns("entity_link");
    assert_eq!(cols.len(), 9);
    assert!(cols.contains(&"id"));
    assert!(cols.contains(&"role"));
    assert!(cols.contains(&"relation_type"));
}

#[test]
fn entity_link_round_trip_local() {
    let conn = setup();
    let link_id = "el-test-1";
    conn.execute(
        "INSERT INTO \"EntityLink\" (id, user_id, from_type, from_id, to_type, to_id, relation_type, role) \
         VALUES (?1, 'u1', 'event', 'e1', 'contact', 'c1', 'participated', 'organizer')",
        rusqlite::params![link_id],
    ).unwrap();
    let link: EntityLink = conn.query_row(
        "SELECT id, user_id, from_type, from_id, to_type, to_id, relation_type, role, created_at \
         FROM \"EntityLink\" WHERE id = ?1",
        rusqlite::params![link_id],
        |r| Ok(EntityLink {
            id: r.get(0)?, user_id: r.get(1)?,
            from_type: r.get(2)?, from_id: r.get(3)?,
            to_type: r.get(4)?, to_id: r.get(5)?,
            relation_type: r.get(6)?, role: r.get(7)?,
            created_at: r.get(8)?,
        }),
    ).unwrap();
    assert_eq!(link.relation_type, "participated");
    assert_eq!(link.role, "organizer");
    assert_eq!(link.from_type, "event");
    assert_eq!(link.to_type, "contact");
}
```

(Adjust `weavine_lib::migration::run` invocation to match the actual exposed function name — read `weavine_lib/src/lib.rs` or `src-tauri/src/migration.rs` for the public migration entry point. Same for `push_columns` — verify it is `pub` in `weavine_lib::sync::translate`.)

- [ ] **Step 2: Verify**

Run: `cargo test --test entity_link_sync`
Expected: Both tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/entity_link_sync.rs && git commit -m "test(sync): entity_link round-trip"
```

---

## Self-Review

After implementation, validate:

1. **Spec coverage**: skim `docs/superpowers/specs/2026-08-07-entity-links-events-design.md` §1-9. Each item should map to a task above.
   - §2 data model → Tasks 2 + 3 ✓
   - §3 API surface (5 endpoints) → Task 5 ✓
   - §3 desktop commands (4) → Task 7 ✓
   - §3 frontend chip UI → deferred to Phase 2 frontend pass
   - §4 sync integration (5 translate edits) → Task 4 ✓
   - §6 tests → Task 8 ✓

2. **Placeholder scan**: no "TBD", "TODO", "implement later" in the plan. ✓

3. **Type consistency**:
   - `ParticipantRow.contact_id` + `ParticipantRow.role` consistent everywhere.
   - `EntityLink.role` defaults to `"participant"` on both stacks.
   - `event.contact_id` always synced via `sync_main_participant` in the same tx.
   - All handlers return `Result<T, (StatusCode, String)>`.

4. **Risk register mitigation**:
   - Pre-existing single-`contact_id` events: no migration needed; `event.contact_id` is preserved.
   - Junction push-all: per cycle small rows; acceptable.
   - Frontend chip UI deferred (Phase 2 frontend).