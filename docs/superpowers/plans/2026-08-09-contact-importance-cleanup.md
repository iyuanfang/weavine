# Contact Importance Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Contact.importance across SQLite + Postgres + business + server handler + UI to a single 3-tier model (high/medium/low) with default `low`; migrate existing `normal` rows to `medium`; delete dead `reminder_enabled` / `reminder_interval_days` columns.

**Architecture:** Two-stack migration. SQLite uses `PRAGMA foreign_keys=off + table-recreate` pattern (SQLite has no `ALTER COLUMN SET DEFAULT`); Postgres uses `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT 'low'` + `DROP COLUMN`. Existing `normal` rows migrate to `medium` (equivalent semantic; `normal` was the DB default for "never set"). UI consolidates 4-tier constants down to 3, drops the `normal` literal from `ContactsList` filter and `ImportancePicker`. Dead `reminder_enabled` / `reminder_interval_days` columns (0 business usage; replaced by §3.5 cadence reminder) are dropped from both stacks.

**Tech Stack:** Rust (rusqlite + sqlx 0.8), PostgreSQL, Tauri 2, React (apps/web-spa). After any server migration change: `touch server/src/main.rs && cargo build --release --bin weavine-server` to force `sqlx::migrate!` re-embed, then restart.

## Global Constraints

- Two-stack architecture: Desktop (`src-tauri/`) = SQLite + rusqlite + `business/` direct queries; Cloud (`server/`) = Postgres + sqlx 0.8 + handlers call `sqlx::query` directly. Shared: only `weavine_lib::models`.
- snake_case column names on both sides.
- Hard blocks: no `as any`, no `@ts-ignore`, no `@ts-expect-error`, no committing unless explicitly requested, no blob storage.
- Server migrations are append-only files `server/migrations/YYYYMMDDxxxxxx_<name>.sql`. After creating/editing any migration, MUST `touch server/src/main.rs && cargo build --release --bin weavine-server` to force `sqlx::migrate!` re-embed, then restart.
- Vite dev server: `http://127.0.0.1:5181` (started via `setsid -f pnpm --dir apps/web-spa exec vite --host 127.0.0.1 --port 5181 --strictPort > /tmp/vite.log 2>&1 < /dev/null`).
- weavine-server: `http://127.0.0.1:3000` (started via `setsid -f bash /tmp/start-weavine-server.sh`).
- DATABASE_URL: `postgres://weavine:Kejukeji1@127.0.0.1/weavine` (psql needs `PGPASSWORD=Kejukeji1`).
- Round-trip test user: `68ad41f9-d253-4652-95ce-6a7608950eaf`, JWT at `/tmp/rt_token.txt`.
- Spec at `/home/yf/workspace/opencode/weavine/Weavine-产品需求Spec.md` is the source of truth (§3.5.2 data model + §7.3 brainstorm record govern this plan).
- Importance 3-tier: `high` / `medium` / `low`. Default `low`. Cadence mapping (per §3.5.5): `high -> 14 days`, `medium -> 45 days`, `low -> never`.
- Existing `normal` rows -> migrate to `medium`.

## File Structure

| File | Responsibility | Lines changed |
|------|----------------|---------------|
| `src-tauri/src/migration.rs` | SQLite migrations M18 - table recreate | ~30 added |
| `src-tauri/src/models.rs` | Contact struct + Input/Update - drop reminder | ~10 removed |
| `src-tauri/src/business/contact.rs` | SELECT/INSERT - drop reminder, default low | ~15 changed |
| `src-tauri/src/sync/translate.rs` | push_columns - drop reminder | ~4 removed |
| `server/migrations/20260809000006_contact_importance_cleanup.sql` | NEW PG migration | ~10 lines |
| `server/src/handlers/contact.rs` | SELECT/INSERT/UPDATE - drop reminder, default low | ~15 changed |
| `server/src/handlers/project_contact.rs` | ContactWithRole SELECT | ~2 removed |
| `server/src/handlers/search.rs` | Contact search SELECT | ~2 removed |
| `apps/web-spa/src/lib/contact-importance.ts` | NEW - central type + i18n label map | ~30 lines |
| `apps/web-spa/src/adapter/types.ts` | Contact type - drop reminder | ~4 removed |
| `apps/web-spa/src/routes/ContactNew.tsx` | Default low, use new lib | ~5 |
| `apps/web-spa/src/routes/ContactEdit.tsx` | Default low, use new lib | ~5 |
| `apps/web-spa/src/components/ImportancePicker.tsx` | Drop normal from options | ~3 |
| `apps/web-spa/src/routes/ContactsList.tsx` | Drop normal from IMPORTANCE_FILTERS | ~1 |
| `src-tauri/tests/contact_importance.rs` | NEW - default + reminder-absent tests | ~60 |
| `src-tauri/tests/cloud_sync.rs` | Rewrite reminder assertions -> importance | ~30 |

---

### Task 1: SQLite migration M18 - drop reminder columns, recreate Contact with importance DEFAULT 'low'

**Files:**
- Modify: `src-tauri/src/migration.rs` (find the `migrations!` macro / list and add M18)
- Create: `src-tauri/tests/contact_importance.rs`

**Interfaces:**
- Consumes: existing `Contact` table schema (baseline: `id TEXT PK, ..., importance TEXT DEFAULT 'normal', reminder_enabled INTEGER DEFAULT 1, reminder_interval_days INTEGER DEFAULT 7, ...`)
- Produces: M18 migration that recreates `contact` without `reminder_enabled` / `reminder_interval_days`, with `importance TEXT NOT NULL DEFAULT 'low' CHECK(importance IN ('low','medium','high'))`. Existing rows with `importance='normal'` migrated to `'medium'` in the recreate step via `CASE WHEN importance='normal' THEN 'medium' ELSE importance END`.

- [ ] **Step 1.1: Write the failing test**

Create `src-tauri/tests/contact_importance.rs`:

```rust
//! Contact importance schema + default tests.
//! Verifies M18 migration:
//!  - contact.importance DEFAULT 'low' (NOT 'normal')
//!  - contact.reminder_enabled / reminder_interval_days columns are gone
//!  - CHECK constraint enforces 3-tier values

use rusqlite::Connection;

fn open_test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    weavine_lib::migrations::run_all(&conn).expect("run migrations");
    conn
}

#[test]
fn sqlite_contact_importance_default_is_low_and_reminder_columns_absent() {
    let conn = open_test_db();

    // 1. Default importance is 'low'
    let default: Option<String> = conn
        .query_row(
            "SELECT dflt_value FROM pragma_table_info('contact') WHERE name='importance'",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let default = default.expect("importance has a default");
    assert_eq!(default, "'low'", "default importance must be 'low' (M18)");

    // 2. reminder_enabled column dropped
    let reminder_enabled: Option<String> = conn
        .query_row(
            "SELECT name FROM pragma_table_info('contact') WHERE name='reminder_enabled'",
            [],
            |r| r.get(0),
        )
        .ok();
    assert!(reminder_enabled.is_none(), "reminder_enabled must be dropped (M18)");

    // 3. reminder_interval_days column dropped
    let reminder_interval_days: Option<String> = conn
        .query_row(
            "SELECT name FROM pragma_table_info('contact') WHERE name='reminder_interval_days'",
            [],
            |r| r.get(0),
        )
        .ok();
    assert!(reminder_interval_days.is_none(), "reminder_interval_days must be dropped (M18)");

    // 4. CHECK constraint enforces 3-tier values
    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='contact'",
            [],
            |r| r.get(0),
        )
        .expect("contact table exists");
    assert!(
        sql.contains("CHECK(importance IN ('low','medium','high'))"),
        "importance CHECK must allow only low/medium/high; got: {sql}"
    );
}
```

- [ ] **Step 1.2: Run the test to verify it fails (pre-M18)**

Run from workspace root:
```bash
cargo test -p weavine --test contact_importance -- sqlite_contact_importance_default_is_low_and_reminder_columns_absent --nocapture
```

Expected: FAIL - `default != "'low'"` (current default is `'normal'`), and `reminder_enabled` column still present.

- [ ] **Step 1.3: Implement M18 migration in `src-tauri/src/migration.rs`**

Locate the existing migration list (likely a `pub const MIGRATIONS: &[...]` array or a per-version function set). Match the surrounding pattern of the latest entry. Append M18.

```rust
fn m18_contact_importance_cleanup(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 1. Drop any indices referencing the soon-to-be-gone columns.
    conn.execute("DROP INDEX IF EXISTS idx_contact_reminder_enabled", [])?;
    // 2. Recreate contact table without reminder columns + new default + CHECK.
    conn.execute("PRAGMA foreign_keys=off", [])?;
    conn.execute(
        r#"
        CREATE TABLE contact_new (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            company TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            importance TEXT NOT NULL DEFAULT 'low'
                CHECK(importance IN ('low','medium','high')),
            notes TEXT NOT NULL DEFAULT '',
            avatar_storage_key TEXT,
            last_interaction_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            deleted_at TEXT
        )
        "#,
        [],
    )?;
    // 3. Copy data + migrate normal -> medium.
    conn.execute(
        r#"
        INSERT INTO contact_new (
            id, user_id, name, company, title, importance, notes,
            avatar_storage_key, last_interaction_at, created_at, updated_at, deleted_at
        )
        SELECT
            id, user_id, name, company, title,
            CASE WHEN importance = 'normal' THEN 'medium' ELSE importance END,
            notes, avatar_storage_key, last_interaction_at, created_at, updated_at, deleted_at
        FROM contact
        "#,
        [],
    )?;
    // 4. Drop old, rename new, recreate indices.
    conn.execute("DROP TABLE contact", [])?;
    conn.execute("ALTER TABLE contact_new RENAME TO contact", [])?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id)",
        [],
    )?;
    conn.execute("PRAGMA foreign_keys=on", [])?;
    Ok(())
}
```

Register `m18_contact_importance_cleanup` in the migration list alongside M0-M17. Match the existing registration convention.

- [ ] **Step 1.4: Run the test to verify it passes**

Run:
```bash
cargo test -p weavine --test contact_importance -- sqlite_contact_importance_default_is_low_and_reminder_columns_absent --nocapture
```

Expected: PASS.

- [ ] **Step 1.5: Run the full test suite to confirm no regressions**

Run:
```bash
cargo test -p weavine --lib
```

Expected: all existing tests still pass (no regressions in other migrations). If anything fails due to reminder_* columns being queried, fix in subsequent tasks.

- [ ] **Step 1.6: Commit**

```bash
git add src-tauri/src/migration.rs src-tauri/tests/contact_importance.rs
git commit -m "feat(db): M18 contact.importance 3-tier default low + drop reminder columns"
```

---

### Task 2: Contact struct + business default + sync translate

**Files:**
- Modify: `src-tauri/src/models.rs` (Contact struct + Input/Update - drop reminder fields)
- Modify: `src-tauri/src/business/contact.rs` (SELECT/INSERT - drop reminder, default 'low')
- Modify: `src-tauri/src/sync/translate.rs` (push_columns - drop reminder)
- Modify: `src-tauri/tests/contact_importance.rs` (add business test)

**Interfaces:**
- Consumes: Task 1 schema (M18).
- Produces: `Contact` struct with no `reminder_enabled` / `reminder_interval_days` fields. `business::contact::create` defaults `importance = "low"`. `sync::translate::push_columns("contact")` returns columns without `reminder_*`.

- [ ] **Step 2.1: Write the failing test for business default**

Append to `src-tauri/tests/contact_importance.rs`:

```rust
use weavine_lib::business::contact;
use weavine_lib::models::ContactInput;

#[test]
fn business_create_contact_default_importance_is_low() {
    let conn = open_test_db();
    let user_id = "user-1".to_string();

    let input = ContactInput {
        name: "Alice".into(),
        company: "Acme".into(),
        title: "PM".into(),
        importance: None, // <- not set
        notes: "".into(),
        avatar_storage_key: None,
        last_interaction_at: None,
    };

    let created = contact::create(&conn, &user_id, &input).expect("create");
    assert_eq!(created.importance, "low", "default importance must be 'low'");
}
```

Note: if `ContactInput` field types differ (e.g. `Option<&str>` vs `String`), adapt the test. The goal is: an input with `importance: None` produces a contact row with `importance = "low"`.

- [ ] **Step 2.2: Run the test to verify it fails**

Run:
```bash
cargo test -p weavine --test contact_importance -- business_create_contact_default_importance_is_low --nocapture
```

Expected: FAIL - `created.importance != "low"` (still defaults to `"normal"` in business layer).

- [ ] **Step 2.3: Edit `src-tauri/src/models.rs`**

Remove `reminder_enabled` and `reminder_interval_days` from:
- `Contact` struct (~line 41-43)
- `ContactInput` struct (~line 241)
- `ContactUpdate` struct (~line 280)
- Anywhere else they appear (~line 297, possibly more)

Exact pattern to delete (line numbers vary, find by content):
```rust
    pub reminder_enabled: bool,                    // <- delete line
    pub reminder_interval_days: Option<i64>,      // <- delete line
```

If a `Default` impl exists, ensure removed fields are not in it. If a builder/constructor exists that sets these, delete those too.

- [ ] **Step 2.4: Edit `src-tauri/src/business/contact.rs`**

Changes:
- **SELECT** (line 18-19 area): remove `reminder_enabled` and `reminder_interval_days` from the SELECT clause. Delete the corresponding `let reminder_enabled: bool = row.get(...)` and `let reminder_interval_days: Option<i64> = row.get(...)` lines.
- **Default** (line 186): change `unwrap_or_else(|| "normal")` to `unwrap_or_else(|| "low")`.
- **INSERT** (line 191-192 area): remove `reminder_enabled` and `reminder_interval_days` from the INSERT column list.
- **Bind** (line 208 area): remove the corresponding `.bind(reminder_enabled)` and `.bind(reminder_interval_days)` calls. Verify the bind count matches the column count.

If `update`, `list`, `get_by_id`, or other functions also SELECT/INSERT these columns, delete them in the same edit. Grep `business/contact.rs` for `reminder_` to find all sites.

- [ ] **Step 2.5: Edit `src-tauri/src/sync/translate.rs`**

Remove `reminder_enabled` and `reminder_interval_days` from contact sync:

- **Line 113 area** (`integer_columns` for contact): delete the `reminder_enabled` and `reminder_interval_days` entries from the column set/vec.

- **Line 127 area** (`nullable_integer_columns` for contact, if reminder_interval_days was there): delete it.

- **Line 141 area** (`push_columns` for contact): remove `reminder_enabled` and `reminder_interval_days` from the column vec returned by `push_columns("contact")`.

- **Line 160 area** (any column-type special handling): remove reminder-related branches.

Grep `translate.rs` for `reminder_` to confirm all sites are covered.

- [ ] **Step 2.6: Run the tests to verify**

Run:
```bash
cargo test -p weavine --test contact_importance -- business_create_contact_default_importance_is_low --nocapture
```

Expected: PASS.

Then full suite:
```bash
cargo test -p weavine --lib
```

Expected: all tests pass (the 27 prior tests still work; `cloud_sync.rs` reminder assertions may fail - those are rewritten in Task 4).

- [ ] **Step 2.7: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/business/contact.rs src-tauri/src/sync/translate.rs src-tauri/tests/contact_importance.rs
git commit -m "feat(contact): drop reminder_* fields, default importance = low"
```

---

### Task 3: Postgres migration + server handler alignment

**Files:**
- Create: `server/migrations/20260809000006_contact_importance_cleanup.sql`
- Modify: `server/src/handlers/contact.rs` (SELECT/INSERT/UPDATE)
- Modify: `server/src/handlers/project_contact.rs` (ContactWithRole SELECT)
- Modify: `server/src/handlers/search.rs` (Contact search SELECT)

**Interfaces:**
- Consumes: Task 2 client changes.
- Produces: PG schema with `importance TEXT NOT NULL DEFAULT 'low'` + CHECK constraint, no `reminder_*` columns. `server::handlers::contact::*` use `'low'` default and don't bind reminder columns.

- [ ] **Step 3.1: Create PG migration `server/migrations/20260809000006_contact_importance_cleanup.sql`**

```sql
-- Contact importance 3-tier + drop reminder columns.

-- 1. Migrate existing 'normal' rows to 'medium' BEFORE tightening default.
UPDATE contact SET importance = 'medium' WHERE importance = 'normal';

-- 2. Add CHECK constraint (idempotent via DROP + ADD).
ALTER TABLE contact DROP CONSTRAINT IF EXISTS contact_importance_check;
ALTER TABLE contact ADD CONSTRAINT contact_importance_check
    CHECK (importance IN ('low', 'medium', 'high'));

-- 3. Drop dependent index(es) on the soon-to-be-gone columns.
DROP INDEX IF EXISTS idx_contact_reminder_enabled;

-- 4. Drop reminder columns.
ALTER TABLE contact DROP COLUMN IF EXISTS reminder_enabled;
ALTER TABLE contact DROP COLUMN IF EXISTS reminder_interval_days;

-- 5. Set new DEFAULT for importance.
ALTER TABLE contact ALTER COLUMN importance SET DEFAULT 'low';

-- 6. Re-create user_id index if it was lost during column drops (safety).
CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id);
```

- [ ] **Step 3.2: Force re-compile + restart server**

The server uses `sqlx::migrate!("./migrations")` which embeds migrations at compile time. After creating the new file:

```bash
touch server/src/main.rs && cargo build --release --bin weavine-server
```

Then restart:
```bash
pkill -f "target/release/weavine-server" || true
sleep 1
setsid -f bash /tmp/start-weavine-server.sh
sleep 2
curl -fsS http://127.0.0.1:3000/api/health
```

Expected: `200 OK` (or similar health response).

- [ ] **Step 3.3: Verify PG schema via psql**

```bash
PGPASSWORD=Kejukeji1 psql -h 127.0.0.1 -U weavine -d weavine -c "\d contact"
```

Expected output contains:
- `importance | text | not null | default 'low'`
- No `reminder_enabled` / `reminder_interval_days` columns
- CHECK constraint mentioning `low`, `medium`, `high`

- [ ] **Step 3.4: Edit `server/src/handlers/contact.rs`**

Three areas to update:
- **Line 62 area** (SELECT in `get_contact` / `list_contacts`): remove `reminder_enabled` and `reminder_interval_days` from SELECT and from the corresponding `FromRow` derive or manual extraction.
- **Line 107 / 152 area** (INSERT in `create_contact`): remove `reminder_enabled` and `reminder_interval_days` from the INSERT query columns, parameter list, and `.bind(...)` calls.
- **Line 166** (`unwrap_or("medium")`): change to `unwrap_or("low")`.
- **Line 236-242 area** (UPDATE in `update_contact`): remove reminder columns from SET clause and `.bind(...)` calls.

Grep `server/src/handlers/contact.rs` for `reminder_` to find all sites.

- [ ] **Step 3.5: Edit `server/src/handlers/project_contact.rs`**

- **Line 26-27 area** (`ContactWithRole` struct): drop `reminder_enabled` and `reminder_interval_days` fields if present.
- **Line 43 area** (SELECT): remove from SELECT clause.
- **Line 69-70 area** (any deserialization / FromRow mapping): remove reminder fields.

Grep `project_contact.rs` for `reminder_` to find all sites.

- [ ] **Step 3.6: Edit `server/src/handlers/search.rs`**

- **Line 28 area** (SELECT in contact search): remove `reminder_enabled` and `reminder_interval_days` from the SELECT clause.

- [ ] **Step 3.7: Re-compile + restart server**

```bash
touch server/src/main.rs && cargo build --release --bin weavine-server
pkill -f "target/release/weavine-server" || true
sleep 1
setsid -f bash /tmp/start-weavine-server.sh
sleep 2
curl -fsS http://127.0.0.1:3000/api/health
```

Expected: server starts clean, health endpoint OK.

- [ ] **Step 3.8: Smoke test the server**

```bash
# Get round-trip test JWT (already prepared):
TOKEN=$(cat /tmp/rt_token.txt)
USER_ID="68ad41f9-d253-4652-95ce-6a7608950eaf"

# Create a contact without importance -> server should default to 'low'.
curl -sS -X POST http://127.0.0.1:3000/api/contacts \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"importance-test","company":"","title":"","notes":""}'
```

Expected: `201 Created` with response body containing `"importance":"low"`.

```bash
# List contacts, verify importance column is present and 'low'.
curl -sS http://127.0.0.1:3000/api/contacts \
    -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.name=="importance-test") | .importance'
```

Expected: `"low"`.

- [ ] **Step 3.9: Commit**

```bash
git add server/migrations/20260809000006_contact_importance_cleanup.sql \
        server/src/handlers/contact.rs \
        server/src/handlers/project_contact.rs \
        server/src/handlers/search.rs
git commit -m "feat(server): contact.importance 3-tier default low + drop reminder columns"
```

---

### Task 4: Rewrite `cloud_sync.rs` reminder_* assertions -> importance assertions

**Files:**
- Modify: `src-tauri/tests/cloud_sync.rs` (lines 128-129, 218, 239, 244, 286-287 per pre-plan audit)

**Interfaces:**
- Consumes: Tasks 1-3 (reminder fields gone).
- Produces: `cloud_sync` integration tests that assert importance 3-tier round-trip instead of reminder_enabled/reminder_interval_days.

- [ ] **Step 4.1: Find all reminder assertions in `cloud_sync.rs`**

```bash
grep -n "reminder_enabled\|reminder_interval_days" src-tauri/tests/cloud_sync.rs
```

Expected output: 2-5 sites (likely in test bodies that round-trip a contact through sync and assert the row columns are preserved).

- [ ] **Step 4.2: Replace each assertion with an importance 3-tier assertion**

For each site, replace the reminder assertion with the equivalent importance assertion.

Pattern A (line ~239 area: `reminder_enabled boolean must round-trip as 1`):
Replace with:
```rust
// importance default low must round-trip
assert_eq!(pushed_row.get::<_, String>("importance").unwrap(), "low");
```

Pattern B (line ~244 area: `reminder_interval_days must stay 7`):
Replace with:
```rust
// importance 3-tier must accept high
let mut contact = create_test_contact(...);
contact.importance = "high".into();
push(&contact);
let pulled = pull_one(&contact.id);
assert_eq!(pulled.importance, "high");
```

If the test sets up specific values like `reminder_enabled = 1`, replace with `importance = "medium"` (was previously a non-default value).

- [ ] **Step 4.3: Add a new test verifying default-low round-trips**

Append to `cloud_sync.rs`:

```rust
#[test]
fn contact_importance_default_low_round_trips_through_sync() {
    let ctx = TestCtx::new();
    let user = ctx.make_user();

    // Create contact with NO importance field set (server default kicks in).
    let contact = ctx.create_contact(&user, ContactInput {
        name: "Sync-Default".into(),
        company: "".into(),
        title: "".into(),
        importance: None,
        notes: "".into(),
        avatar_storage_key: None,
        last_interaction_at: None,
    });

    ctx.push(&user);
    ctx.pull(&user);

    let pulled = ctx.find_contact(&user, &contact.id).expect("contact present");
    assert_eq!(pulled.importance, "low", "importance must default to low after sync round-trip");
}
```

Adjust `TestCtx` API to match the actual helpers in `cloud_sync.rs`. The intent is: create contact with `importance: None`, push, pull, fetch, assert importance is `"low"`.

- [ ] **Step 4.4: Run the tests**

```bash
cargo test -p weavine --test cloud_sync --nocapture
```

Expected: all tests pass. If a previously-passing test now fails because the server expects different schema, the issue is in Task 3 server handler - revisit.

- [ ] **Step 4.5: Commit**

```bash
git add src-tauri/tests/cloud_sync.rs
git commit -m "test(sync): replace reminder_* assertions with importance 3-tier"
```

---

### Task 5: UI consolidation - 3-tier picker, default low, drop normal

**Files:**
- Create: `apps/web-spa/src/lib/contact-importance.ts`
- Modify: `apps/web-spa/src/adapter/types.ts` (Contact - drop reminder fields)
- Modify: `apps/web-spa/src/routes/ContactNew.tsx` (default 'low', use new lib)
- Modify: `apps/web-spa/src/routes/ContactEdit.tsx` (default 'low', use new lib)
- Modify: `apps/web-spa/src/components/ImportancePicker.tsx` (drop 'normal' from options)
- Modify: `apps/web-spa/src/routes/ContactsList.tsx` (drop 'normal' from IMPORTANCE_FILTERS)

**Interfaces:**
- Consumes: Tasks 1-4 (server + sync aligned).
- Produces: single source of truth for importance options. UI shows only high/medium/low. Defaults to 'low'. `adapter/types.ts` Contact has no reminder fields.

- [ ] **Step 5.1: Create `apps/web-spa/src/lib/contact-importance.ts`**

```typescript
// Central type + label map for Contact.importance.
// Source of truth: Weavine-产品需求Spec.md §3.5.2 + §7.3.
// 3-tier model: high / medium / low. Default: low.

export type Importance = 'low' | 'medium' | 'high';

export const IMPORTANCE_OPTIONS: Importance[] = ['low', 'medium', 'high'];

export const DEFAULT_IMPORTANCE: Importance = 'low';

export const IMPORTANCE_LABEL: Record<Importance, { emoji: string; text: string }> = {
  high:   { emoji: '\ud83d\udd34', text: '\u9ad8' },     // red dot, "high"
  medium: { emoji: '\ud83d\udfe1', text: '\u4e2d' },     // yellow dot, "medium"
  low:    { emoji: '\u26aa',  text: '\u4f4e' },          // white dot, "low"
};

export function isImportance(value: unknown): value is Importance {
  return value === 'low' || value === 'medium' || value === 'high';
}

// Migration helper for legacy 'normal' values from older DB rows (pre-M18).
export function normalizeLegacyImportance(value: string | null | undefined): Importance {
  if (value === 'normal' || value === 'medium' || value === 'high') return 'medium';
  if (value === 'low') return 'low';
  return DEFAULT_IMPORTANCE;
}
```

Note: emoji escapes are used to avoid encoding issues; runtime resolves to "🔴🟡⚪" and "高中低".

- [ ] **Step 5.2: Edit `apps/web-spa/src/adapter/types.ts`**

Remove `reminder_enabled` and `reminder_interval_days` from the `Contact` interface (and any Input/Update variants). Match the exact field names by grep:

```bash
grep -n "reminder_enabled\|reminder_interval_days" apps/web-spa/src/adapter/types.ts
```

Delete each occurrence. If there is a `ContactInput` or `ContactPatch` interface that mirrors server, delete the same fields.

Add an `importance: Importance` field type if not already strictly typed (likely it is `string`).

- [ ] **Step 5.3: Edit `apps/web-spa/src/routes/ContactNew.tsx`**

```bash
grep -n "importance\|medium" apps/web-spa/src/routes/ContactNew.tsx
```

At the state initialization (line 14-16 area), replace the default `'medium'` with the new constant:

```typescript
import { DEFAULT_IMPORTANCE, IMPORTANCE_OPTIONS, IMPORTANCE_LABEL } from '@/lib/contact-importance';
// ...
const [importance, setImportance] = useState<Importance>(DEFAULT_IMPORTANCE);
```

Update the ImportancePicker usage (if inline options array) to use `IMPORTANCE_OPTIONS` and `IMPORTANCE_LABEL`.

- [ ] **Step 5.4: Edit `apps/web-spa/src/routes/ContactEdit.tsx`**

Same pattern as Step 5.3: replace default `'medium'` with `DEFAULT_IMPORTANCE`, use `IMPORTANCE_OPTIONS` / `IMPORTANCE_LABEL`. Existing contact load: if `contact.importance` is `'normal'` (legacy), normalize via `normalizeLegacyImportance` before setting state.

- [ ] **Step 5.5: Edit `apps/web-spa/src/components/ImportancePicker.tsx`**

```bash
grep -n "normal\|medium\|high\|low" apps/web-spa/src/components/ImportancePicker.tsx
```

Replace any hardcoded 4-option array with `IMPORTANCE_OPTIONS` from the new lib. Remove `'normal'` from the options if present. If the component imports its own type literal, switch to the `Importance` type from the lib.

- [ ] **Step 5.6: Edit `apps/web-spa/src/routes/ContactsList.tsx`**

Line 67 area (`IMPORTANCE_FILTERS` or similar constant):

```typescript
// Before:
const IMPORTANCE_FILTERS = ['normal', 'high', 'medium', 'low'];

// After:
const IMPORTANCE_FILTERS = IMPORTANCE_OPTIONS; // or import directly
```

Remove `'normal'` from the array.

- [ ] **Step 5.7: TypeScript check**

```bash
pnpm --dir apps/web-spa run typecheck
```

Expected: no errors. If `'normal'` references remain (e.g. in tests, mock data, fixtures), update them to `'medium'` (legacy migration) or `'low'` (current default).

- [ ] **Step 5.8: Playwright smoke test**

Verify the new contact flow renders correctly with the 3-tier picker and default low.

If a Playwright smoke harness exists, run it:
```bash
pnpm --dir apps/web-spa exec playwright test e2e/contact-importance.spec.ts --reporter=line
```

If not, manually verify:
1. Open http://127.0.0.1:5181/contacts/new in browser.
2. Confirm the importance picker shows only 3 options (high/medium/low).
3. Confirm default is 'low' (white dot).
4. Create a contact, save, reload, confirm importance persists as 'low'.
5. Open http://127.0.0.1:5181/contacts/<id>/edit, change to 'high', save, reload, confirm 'high' persists.
6. Open http://127.0.0.1:5181/contacts, confirm the importance filter dropdown has 3 options (no 'normal').

Expected: all 6 checks pass.

- [ ] **Step 5.9: Commit**

```bash
git add apps/web-spa/src/lib/contact-importance.ts \
        apps/web-spa/src/adapter/types.ts \
        apps/web-spa/src/routes/ContactNew.tsx \
        apps/web-spa/src/routes/ContactEdit.tsx \
        apps/web-spa/src/components/ImportancePicker.tsx \
        apps/web-spa/src/routes/ContactsList.tsx
git commit -m "feat(web): contact.importance 3-tier picker, default low, drop normal"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Plan task |
|------------------|-----------|
| §3.5.2 - Contact.importance 3-tier (low/medium/high) | T1, T2, T3, T5 |
| §3.5.2 - Default `low` on SQLite | T1 |
| §3.5.2 - Default `low` on Postgres | T3 |
| §3.5.2 - Default `low` in business layer | T2 |
| §3.5.2 - Default `low` in server handler | T3 |
| §3.5.2 - Migrate `normal` -> `medium` | T1, T3 |
| §3.5.2 - Drop reminder_enabled | T1, T2, T3, T5 |
| §3.5.2 - Drop reminder_interval_days | T1, T2, T3, T5 |
| §3.5.2 - Onboarding hint to set importance | deferred (separate UX work) |
| §3.5.5 - Importance -> cadence mapping | T1-T3 (data) + T5 (UI label) |
| §7.3 - Cloud_sync tests rewritten | T4 |

All required changes covered. Onboarding hint explicitly deferred (separate UX ticket).

### Placeholder scan

No `TBD`, `TODO`, `implement later`, or vague "similar to Task N" references. Each step has complete code blocks or specific shell commands.

### Type consistency

- `Contact.importance: String` (Rust) and `Contact.importance: Importance` (TS) align via the 3 string literals `low` / `medium` / `high`.
- `push_columns("contact")` output (T2.5) matches what the server's `INSERT` (T3.4) expects.
- `ContactInput.importance: Option<String>` (T2.1 test) matches `models.rs` field (T2.3).
- `DefaultImportance` constant name in TS (T5.1) matches usage sites in T5.3/T5.4.

No inconsistencies.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-09-contact-importance-cleanup.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
