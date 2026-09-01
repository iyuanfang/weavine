//! Desktop sync client for weavine v0.2.0b.
//!
//! Syncs local SQLite data to/from the cloud server using the sync API protocol.
//! Architecture: push-then-pull. Local changes are pushed to the server first,
//! then remote changes are pulled and applied locally.

pub mod api;
pub mod config;
mod keys;
pub mod translate;

use api::*;
use config::*;
use rusqlite::Connection;
use serde_json::{Map, Value};
use translate::*;

pub use config::{clear_all as unlink, is_linked};

// ── Result types ──────────────────────────────────────

/// Outcome of a single sync cycle.
#[derive(Debug, Default, serde::Serialize)]
pub struct SyncResult {
    pub pushed: usize,
    pub pulled: usize,
    pub conflicts: usize,
    pub conflict_details: Vec<Conflict>,
}

// ── Public API ────────────────────────────────────────

/// Link this desktop to a cloud account.
///
/// Logs into the server, stores credentials in SyncState, and runs
/// an initial sync (push local data, pull remote data).
pub async fn link(
    conn: &mut Connection,
    server_url: &str,
    email: &str,
    password: &str,
) -> anyhow::Result<SyncResult> {
    let resp =
        api::login(server_url.trim_end_matches('/'), email, password).await?;

    config::set(conn, KEY_SERVER_URL, server_url.trim_end_matches('/'))?;
    config::set(conn, KEY_ACCESS_TOKEN, &resp.access_token)?;
    config::set(conn, KEY_REFRESH_TOKEN, &resp.refresh_token)?;
    config::set(conn, KEY_DEVICE_ID, &resp.device_id)?;
    config::set(conn, KEY_USER_ID, &resp.user_id)?;
    config::set(conn, KEY_USER_EMAIL, email)?;

    config::set(conn, KEY_LAST_PULLED_REVISION, "0")?;

    sync_once_with_conn(conn).await
}

/// Run a single sync cycle: push then pull.
pub async fn sync_once(conn: &mut Connection) -> anyhow::Result<SyncResult> {
    sync_once_with_conn(conn).await
}

/// Spawn a blocking thread that periodically runs `sync_once`.
///
/// Runs one cycle immediately, then sleeps `interval_secs` between cycles.
/// Each iteration re-checks `is_linked`: unlinked devices stay quiet,
/// devices linked later via `cloud_login` start syncing on the next tick.
pub fn spawn_periodic(db_path: std::path::PathBuf, interval_secs: u64) {
    const FOLLOWUP_INTERVAL: u64 = 30;
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[sync] periodic: create runtime: {e}");
                return;
            }
        };
        let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE;
        let conn = match rusqlite::Connection::open_with_flags(&db_path, flags) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] periodic: open db: {e}");
                return;
            }
        };
        let mut conn = conn;
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

        let interval = std::time::Duration::from_secs(interval_secs);
        let followup = std::time::Duration::from_secs(FOLLOWUP_INTERVAL);
        loop {
            if config::is_linked(&conn).unwrap_or(false) {
                let pulled = match rt.block_on(sync_once_with_conn(&mut conn)) {
                    Ok(r) => {
                        eprintln!(
                            "[sync] periodic: pushed={} pulled={} conflicts={}",
                            r.pushed, r.pulled, r.conflicts
                        );
                        r.pulled
                    }
                    Err(e) => {
                        eprintln!("[sync] periodic failed: {e}");
                        0
                    }
                };
                if pulled > 0 {
                    std::thread::sleep(followup);
                    continue;
                }
            }
            std::thread::sleep(interval);
        }
    });
}

// ── Internal implementation ───────────────────────────

async fn sync_once_with_conn(conn: &mut Connection) -> anyhow::Result<SyncResult> {
    if !config::is_linked(conn)? {
        return Err(anyhow::anyhow!("not linked to a cloud account"));
    }

    let server_url = config::get(conn, KEY_SERVER_URL)?.unwrap_or_default();
    let access_token = get_token(conn).await?;
    let user_id = config::get(conn, KEY_USER_ID)?.unwrap_or_default();
    let device_id = config::get(conn, KEY_DEVICE_ID)?.unwrap_or_default();

    let mut result = SyncResult::default();

    // ── Phase 1: Push local changes ─────────────────
    let push_revision = push_all(
        conn,
        &server_url,
        &access_token,
        &user_id,
        &device_id,
        &mut result,
    )
    .await?;

    // ── Phase 2: Pull remote changes ────────────────
    pull_all(conn, &server_url, &access_token, &mut result).await?;

    // ── Phase 3: Update last pushed revision ────────
    if push_revision > 0 {
        config::set(conn, KEY_LAST_PUSHED_REVISION, &push_revision.to_string())?;
    }

    Ok(result)
}

/// Get a valid access token, refreshing if necessary.
async fn get_token(conn: &Connection) -> anyhow::Result<String> {
    let server_url = config::get(conn, KEY_SERVER_URL)?
        .ok_or_else(|| anyhow::anyhow!("no server_url configured"))?;
    let access_token = config::get(conn, KEY_ACCESS_TOKEN)?
        .ok_or_else(|| anyhow::anyhow!("no access_token"))?;
    let refresh_tok = config::get(conn, KEY_REFRESH_TOKEN)?
        .ok_or_else(|| anyhow::anyhow!("no refresh_token"))?;

    // Try to use the current access_token first.
    // If it fails, refresh and retry.
    match api::manifest(&server_url, &access_token).await {
        Ok(_) => Ok(access_token),
        Err(_) => {
            // Access token expired — refresh
            let resp = refresh_token(&server_url, &refresh_tok).await?;
            config::set(conn, KEY_ACCESS_TOKEN, &resp.access_token)?;
            if let Some(new_refresh) = resp.refresh_token {
                config::set(conn, KEY_REFRESH_TOKEN, &new_refresh)?;
            }
            Ok(resp.access_token)
        }
    }
}

/// Push all local data to the server.
/// Returns the server_revision from the push response.
async fn push_all(
    conn: &Connection,
    server_url: &str,
    access_token: &str,
    cloud_user_id: &str,
    device_id: &str,
    result: &mut SyncResult,
) -> anyhow::Result<i64> {
    let mut entities = Vec::new();
    let local_user_id = "local-default";
    let last_pushed_at = config::get(conn, KEY_LAST_PUSHED_AT)?.unwrap_or_default();
    let mut max_pushed_at: String = last_pushed_at.clone();

    for kind in ENTITY_KINDS {
        let table = match kind_to_sqlite_table(kind) {
            Some(t) => t,
            None => continue,
        };

        let cols = push_columns(kind);
        if cols.is_empty() {
            continue;
        }

        let col_list = cols
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let has_updated_at = UPDATED_AT_TABLES.contains(&kind);
        let sql = if has_updated_at {
            format!(
                "SELECT {} FROM \"{}\" WHERE \"user_id\" = ?1 AND \"updated_at\" > ?2",
                col_list, table
            )
        } else {
            format!(
                "SELECT {} FROM \"{}\" WHERE \"user_id\" = ?1",
                col_list, table
            )
        };

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[sync] push: prepare {kind} failed: {e}");
                continue;
            }
        };

        let params: Vec<&dyn rusqlite::types::ToSql> = if has_updated_at {
            vec![&local_user_id, &last_pushed_at]
        } else {
            vec![&local_user_id]
        };
        let rows: Vec<Value> = match stmt.query_map(rusqlite::params_from_iter(params), |row| {
            let mut map = Map::new();
            let bool_cols = boolean_columns(kind);
            let int_cols = integer_columns(kind);
            for (i, col) in cols.iter().enumerate() {
                if bool_cols.contains(col) {
                    let v: Option<i64> = row.get(i).ok();
                    if let Some(n) = v {
                        map.insert(col.to_string(), Value::Bool(n != 0));
                    }
                } else if int_cols.contains(col) {
                    let v: Option<i64> = row.get(i).ok();
                    if let Some(n) = v {
                        map.insert(
                            col.to_string(),
                            Value::Number(serde_json::Number::from(n)),
                        );
                    }
                } else {
                    let val: Option<String> = row.get(i).ok();
                    if let Some(v) = val {
                        map.insert(col.to_string(), Value::String(v));
                    }
                }
            }
            Ok(Value::Object(map))
        }) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                eprintln!("[sync] push: query {kind} failed: {e}");
                continue;
            }
        };

        if rows.is_empty() {
            continue;
        }

        for row in &rows {
            if let Some(ua) = row.get("updated_at").and_then(|v| v.as_str()) {
                if ua > max_pushed_at.as_str() {
                    max_pushed_at = ua.to_string();
                }
            }
        }

        let mapped_rows: Vec<Value> = rows
            .into_iter()
            .map(|row| {
                let mut snake = obj_camel_to_snake(&row);
                if let Value::Object(ref mut obj) = snake {
                    obj.insert(
                        "user_id".to_string(),
                        Value::String(cloud_user_id.to_string()),
                    );
                    add_junction_id(kind, obj);
                    drop_desktop_only_columns(kind, obj);
                }
                snake
            })
            .collect();

        entities.push(EntityPush {
            kind: kind.to_string(),
            rows: mapped_rows,
        });
    }

    if entities.is_empty() {
        return Ok(0);
    }

    // F6: chunk each EntityPush.rows into PUSH_CHUNK_SIZE batches to keep
    // per-request payload bounded; server-side savepoint batching remains
    // unchanged, but per-row trigger overhead amortizes over fewer round-trips.
    let mut last_server_rev = 0;
    // Conflicts raised by *this* push only. `result.conflicts` may already
    // carry counts from earlier stages, so it cannot be used as the retry
    // signal here.
    let mut push_conflicts = 0usize;
    for entity in entities.iter() {
        for chunk_rows in entity.rows.chunks(PUSH_CHUNK_SIZE) {
            let chunk = EntityPush {
                kind: entity.kind.clone(),
                rows: chunk_rows.to_vec(),
            };
            let push_resp = api::push(
                server_url,
                access_token,
                device_id,
                vec![chunk],
            )
            .await?;
            result.pushed += push_resp.accepted.len();
            result.conflicts += push_resp.conflicts.len();
            push_conflicts += push_resp.conflicts.len();
            last_server_rev = push_resp.server_revision;
            for c in &push_resp.conflicts {
                eprintln!(
                    "[sync] conflict kind={} row_id={} reason={}",
                    c.kind, c.row_id, c.reason
                );
                result.conflict_details.push(c.clone());
                let _ = persist_sync_conflict(conn, c);
            }
        }
    }
    // Only advance the watermark when every row was accepted. The next push
    // selects `updated_at > watermark`, so advancing past rows the server
    // rejected would strand them forever — they would never be retried.
    // Holding the watermark still is safe: re-pushing accepted rows is an
    // idempotent upsert.
    if push_conflicts == 0 && !max_pushed_at.is_empty() && max_pushed_at != last_pushed_at {
        config::set(conn, KEY_LAST_PUSHED_AT, &max_pushed_at)?;
    }
    Ok(last_server_rev)
}

const PUSH_CHUNK_SIZE: usize = 500;

/// Pull remote changes and apply them locally.
async fn pull_all(
    conn: &mut Connection,
    server_url: &str,
    access_token: &str,
    result: &mut SyncResult,
) -> anyhow::Result<()> {
    let mut since = last_pulled_revision(conn)?;
    let local_user_id = "local-default";

    loop {
        let pull_resp = api::pull(server_url, access_token, since, 200).await?;

        let tx = conn.transaction()?;
        for change in &pull_resp.rows {
            if let Err(e) = apply_change(&tx, change, local_user_id) {
                eprintln!(
                    "[sync] apply {} {} failed: {}",
                    change.kind,
                    change.row_id,
                    e
                );
            } else {
                result.pulled += 1;
            }
        }
        tx.commit()?;

        config::set(
            conn,
            KEY_LAST_PULLED_REVISION,
            &pull_resp.latest_revision.to_string(),
        )?;

        if !pull_resp.has_more {
            break;
        }
        since = pull_resp.latest_revision;
    }

    Ok(())
}

fn persist_sync_conflict(conn: &Connection, c: &Conflict) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS \"SyncConflicts\" (
            \"id\"         INTEGER PRIMARY KEY AUTOINCREMENT,
            \"kind\"       TEXT NOT NULL,
            \"row_id\"     TEXT NOT NULL DEFAULT '',
            \"reason\"     TEXT NOT NULL,
            \"created_at\" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS \"SyncConflicts_created_at_idx\"
            ON \"SyncConflicts\"(\"created_at\" DESC);",
    )?;
    conn.execute(
        "INSERT INTO \"SyncConflicts\" (\"kind\", \"row_id\", \"reason\") VALUES (?1, ?2, ?3)",
        rusqlite::params![&c.kind, &c.row_id, &c.reason],
    )?;
    let _rows = conn.execute(
        "DELETE FROM \"SyncConflicts\" WHERE \"id\" NOT IN (
            SELECT \"id\" FROM \"SyncConflicts\" ORDER BY \"created_at\" DESC LIMIT 500
        )",
        [],
    )?;
    Ok(())
}
fn apply_change(
    conn: &Connection,
    change: &ChangeRow,
    local_user_id: &str,
) -> anyhow::Result<()> {
    let kind = canonical_kind(&change.kind);
    let table = match kind_to_sqlite_table(kind) {
        Some(t) => t,
        None => {
            return Err(anyhow::anyhow!("unknown entity kind: {}", change.kind));
        }
    };

    match change.op.as_str() {
        "INSERT" | "UPDATE" => {
            let data = match &change.data {
                Some(d) => obj_snake_to_camel(d),
                None => {
                    return Err(anyhow::anyhow!("no data for {} {}", change.kind, change.op));
                }
            };

            let obj = match data {
                Value::Object(ref o) => o,
                _ => return Err(anyhow::anyhow!("data is not an object")),
            };

            // Build INSERT OR REPLACE
            let cols = push_columns(kind);
            if cols.is_empty() {
                return Err(anyhow::anyhow!("no columns for {}", change.kind));
            }

            let col_list = cols
                .iter()
                .map(|c| format!("\"{}\"", c))
                .collect::<Vec<_>>()
                .join(", ");
            let placeholders: Vec<String> =
                (1..=cols.len()).map(|i| format!("?{}", i)).collect();
            let ph_list = placeholders.join(", ");

            // `INSERT OR REPLACE` is really DELETE-then-INSERT, and with
            // foreign_keys=ON that DELETE cascades: applying a pulled update
            // for a contact / event / note would wipe its Reminder,
            // ContactTag, NoteEntity and participant children. Those child
            // rows have older revisions, so they are never re-pulled — the
            // loss is silent and permanent.
            //
            // A true upsert (`ON CONFLICT … DO UPDATE`) is a plain UPDATE and
            // fires no cascade. It also leaves columns that are absent from
            // `push_columns` (e.g. Note.imported_from) untouched, which REPLACE
            // would have reset to NULL.
            //
            // The two composite-PK junction tables (contact_tag,
            // project_contact) have no `id` to conflict on, but they are
            // leaves with no children of their own, so REPLACE is safe there.
            let sql = if cols.contains(&"id") {
                let update_set = cols
                    .iter()
                    .filter(|c| **c != "id")
                    .map(|c| format!("\"{c}\" = excluded.\"{c}\""))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "INSERT INTO \"{}\" ({}) VALUES ({}) \
                     ON CONFLICT(\"id\") DO UPDATE SET {}",
                    table, col_list, ph_list, update_set
                )
            } else {
                format!(
                    "INSERT OR REPLACE INTO \"{}\" ({}) VALUES ({})",
                    table, col_list, ph_list
                )
            };

            let mut stmt = conn.prepare(&sql)?;

            let bool_cols = boolean_columns(kind);
            let null_int_cols = nullable_integer_columns(kind);
            let zero_int_cols = default_zero_integer_columns(kind);

            let params: Vec<Box<dyn rusqlite::types::ToSql>> = cols
                .iter()
                .map(|col| {
                    if *col == "user_id" {
                        Box::new(local_user_id.to_string()) as Box<dyn rusqlite::types::ToSql>
                    } else if bool_cols.contains(col) {
                        let v = obj.get(*col).and_then(|x| x.as_bool()).unwrap_or(false);
                        Box::new(if v { 1i64 } else { 0i64 }) as Box<dyn rusqlite::types::ToSql>
                    } else if null_int_cols.contains(col) {
                        match obj.get(*col).and_then(|x| x.as_i64()) {
                            Some(n) => Box::new(n) as Box<dyn rusqlite::types::ToSql>,
                            None => Box::new(rusqlite::types::Null) as Box<dyn rusqlite::types::ToSql>,
                        }
                    } else if zero_int_cols.contains(col) {
                        let n = obj.get(*col).and_then(|x| x.as_i64()).unwrap_or(0);
                        Box::new(n) as Box<dyn rusqlite::types::ToSql>
                    } else {
                        // TEXT: preserve NULL instead of coercing to "".
                        // Critical: pushing "" back to server corrupts
                        // project.archived_at (UI treats "" as archived)
                        // and breaks UNIQUE(user_id, email) on Contact
                        // when multiple contacts have null email.
                        match obj.get(*col) {
                            Some(Value::String(s)) => {
                                Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>
                            }
                            Some(Value::Null) | None => {
                                Box::new(rusqlite::types::Null) as Box<dyn rusqlite::types::ToSql>
                            }
                            Some(other) => {
                                Box::new(other.to_string()) as Box<dyn rusqlite::types::ToSql>
                            }
                        }
                    }
                })
                .collect();

            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();

            stmt.execute(param_refs.as_slice())?;
        }
        "DELETE" => {
            // Junction tables (contact_tag, project_contact, entity_link,
            // note_entity) have no `deleted_at` column on SQLite (only the 8
            // user-data tables do — see soft_delete_cols in migration.rs).
            // Running the soft-delete UPDATE below against a junction table
            // would crash with "no such column: deleted_at" and abort the
            // entire pull transaction.
            //
            // Two of the four junction tables (contact_tag, project_contact)
            // also lack an `id` column — they use a composite PK. The server
            // sync trigger currently sets `v_data := NULL` on DELETE
            // (server/migrations/20260705000003_sync_engine.sql), so a
            // composite-PK DELETE doesn't carry the lookup columns. We
            // hard-delete by composite key when data is present and log a
            // warning otherwise (until the server trigger grows OLD.*
            // capture for junction tables).
            if JUNCTION_TABLES.contains(&kind) {
                delete_junction_row(conn, kind, table, change, local_user_id)?;
            } else {
                let now = chrono::Utc::now()
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string();
                conn.execute(
                    &format!(
                        "UPDATE \"{}\" SET \"deleted_at\" = ?1, \"updated_at\" = ?1 \
                         WHERE \"id\" = ?2 AND \"user_id\" = ?3 AND \"deleted_at\" IS NULL",
                        table
                    ),
                    rusqlite::params![now, change.row_id, local_user_id],
                )?;
            }
        }
        _ => {
            return Err(anyhow::anyhow!("unknown op: {}", change.op));
        }
    }

    Ok(())
}

/// Hard-delete a row from a junction table on a pulled DELETE op.
///
/// `entity_link` and `note_entity` have an `id` PK that matches
/// `change.row_id`, so a plain DELETE by id works.
///
/// `contact_tag` and `project_contact` have no `id` column on SQLite (they
/// use a composite PK `(user_id, contact_id, tag_id)` and `(user_id,
/// project_id, contact_id)` respectively). The server sync trigger currently
/// stores `v_data := NULL` on DELETE
/// (server/migrations/20260705000003_sync_engine.sql), so the composite
/// lookup columns are not in the change payload. We hard-delete by composite
/// key when the payload carries them; otherwise we log and skip — the server
/// trigger needs to grow OLD.* capture on DELETE before we can resolve
/// these from the pull stream alone.
fn delete_junction_row(
    conn: &Connection,
    kind: &str,
    table: &str,
    change: &ChangeRow,
    local_user_id: &str,
) -> anyhow::Result<()> {
    match kind {
        "entity_link" | "note_entity" => {
            conn.execute(
                &format!(
                    "DELETE FROM \"{}\" WHERE \"id\" = ?1 AND \"user_id\" = ?2",
                    table
                ),
                rusqlite::params![change.row_id, local_user_id],
            )?;
        }
        "contact_tag" => {
            delete_junction_composite(
                conn,
                table,
                change,
                local_user_id,
                "contact_id",
                "tag_id",
            )?;
        }
        "project_contact" => {
            delete_junction_composite(
                conn,
                table,
                change,
                local_user_id,
                "project_id",
                "contact_id",
            )?;
        }
        other => {
            return Err(anyhow::anyhow!(
                "junction kind '{}' not handled by delete_junction_row (JUNCTION_TABLES drift?)",
                other
            ));
        }
    }
    Ok(())
}

fn delete_junction_composite(
    conn: &Connection,
    table: &str,
    change: &ChangeRow,
    local_user_id: &str,
    c1: &str,
    c2: &str,
) -> anyhow::Result<()> {
    let obj = match &change.data {
        Some(Value::Object(o)) => o,
        _ => {
            eprintln!(
                "[sync] {} DELETE without data (row_id={}); \
                 server trigger must capture OLD on DELETE for this to resolve",
                table, change.row_id
            );
            return Ok(());
        }
    };
    let v1 = obj.get(c1).and_then(|v| v.as_str()).unwrap_or("");
    let v2 = obj.get(c2).and_then(|v| v.as_str()).unwrap_or("");
    if v1.is_empty() || v2.is_empty() {
        eprintln!(
            "[sync] {} DELETE missing composite key (row_id={}, missing {} or {}); skipping",
            table, change.row_id, c1, c2
        );
        return Ok(());
    }
    let sql = format!(
        "DELETE FROM \"{}\" WHERE \"user_id\" = ?1 AND \"{}\" = ?2 AND \"{}\" = ?3",
        table, c1, c2
    );
    conn.execute(
        &sql,
        rusqlite::params![local_user_id, v1, v2],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::translate::push_columns;
    use rusqlite::Connection;
    use serde_json::json;

    fn open_minimal() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Project (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                template TEXT NOT NULL,
                stage TEXT NOT NULL,
                start_at TEXT,
                due_at TEXT,
                completed_at TEXT,
                archived_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE Contact (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                nickname TEXT,
                name TEXT,
                company TEXT,
                title TEXT,
                address TEXT,
                email TEXT,
                phone TEXT,
                wechat TEXT,
                notes TEXT,
                importance TEXT,
                last_interaction_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX Contact_user_id_email_key ON Contact(user_id, email);",
        )
        .unwrap();
        conn
    }

    fn change_row(kind: &str, op: &str, row_id: &str, data: Value) -> ChangeRow {
        ChangeRow {
            kind: kind.into(),
            op: op.into(),
            row_id: row_id.into(),
            data: Some(data),
            revision: 1,
        }
    }

    #[test]
    fn pull_preserves_null_for_nullable_text_column() {
        let conn = open_minimal();
        let data = json!({
            "id": "p1", "user_id": "u1", "title": "Demo",
            "description": null, "template": "general", "stage": "进行中",
            "start_at": null, "due_at": null, "completed_at": null,
            "archived_at": null,
            "created_at": "2026-07-05T00:00:00Z",
            "updated_at": "2026-07-05T00:00:00Z"
        });
        apply_change(&conn, &change_row("project", "UPDATE", "p1", data), "local-default")
            .expect("apply");

        let (desc, archived): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT description, archived_at FROM Project WHERE id='p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("query");
        assert!(desc.is_none(), "null description must stay NULL, got {desc:?}");
        assert!(archived.is_none(), "null archived_at must stay NULL, got {archived:?}");
    }

    #[test]
    fn pull_preserves_string_for_set_text_column() {
        let conn = open_minimal();
        let data = json!({
            "id": "p1", "user_id": "u1", "title": "Demo",
            "template": "general", "stage": "进行中",
            "start_at": "2026-08-01T00:00:00Z", "due_at": null, "completed_at": null,
            "archived_at": "2026-07-05T12:00:00Z",
            "created_at": "2026-07-05T00:00:00Z",
            "updated_at": "2026-07-05T00:00:00Z"
        });
        apply_change(&conn, &change_row("project", "UPDATE", "p1", data), "local-default")
            .expect("apply");

        let (template, archived, due): (String, String, Option<String>) = conn
            .query_row(
                "SELECT template, archived_at, due_at FROM Project WHERE id='p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("query");
        assert_eq!(template, "general");
        assert_eq!(archived, "2026-07-05T12:00:00Z");
        assert!(due.is_none());
    }

    #[test]
    fn pull_multiple_null_emails_do_not_collide_on_unique_index() {
        let conn = open_minimal();
        for i in 0..3 {
            let data = json!({
                "id": format!("c{i}"), "user_id": "local-default",
                "nickname": null, "name": format!("Person {i}"),
                "company": null, "title": null, "address": null,
                "email": null, "phone": null, "wechat": null,
                "notes": null, "importance": null,
                "last_interaction_at": null,
                "created_at": "2026-07-05T00:00:00Z",
                "updated_at": "2026-07-05T00:00:00Z"
            });
            apply_change(
                &conn,
                &change_row("contact", "INSERT", &format!("c{i}"), data),
                "local-default",
            )
            .expect("apply");
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM Contact", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3, "all 3 contacts must insert despite null email");
    }

    #[test]
    fn push_columns_includes_archived_at() {
        let cols = push_columns("project");
        assert!(cols.contains(&"archived_at"));
    }

    #[test]
    fn pull_entity_links_plural_kind_applies_to_entity_link_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE EntityLink (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                from_type TEXT NOT NULL,
                from_id TEXT NOT NULL,
                to_type TEXT NOT NULL,
                to_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                role TEXT NOT NULL,
                label TEXT,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        let data = json!({
            "id": "el1", "user_id": "u1",
            "from_type": "event", "from_id": "ev1",
            "to_type": "contact", "to_id": "c1",
            "relation_type": "participated", "role": "participant",
            "created_at": "2026-08-09T00:00:00Z"
        });
        // PG trigger logs TG_TABLE_NAME = `entity_links` (plural).
        apply_change(&conn, &change_row("entity_links", "INSERT", "rel1", data), "local-default")
            .expect("apply alias kind");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM EntityLink", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "plural pull kind must land in EntityLink");
    }

    #[test]
    fn pull_reminder_preserves_invitation_token() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Reminder (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                contact_id TEXT,
                event_id TEXT,
                trigger_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                dispatched BOOLEAN NOT NULL DEFAULT false,
                dismissed BOOLEAN NOT NULL DEFAULT false,
                invitation_token TEXT,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        let data = json!({
            "id": "r1", "user_id": "u1",
            "contact_id": "c1", "event_id": null,
            "trigger_at": "2026-08-15T09:00:00Z",
            "kind": "cadence",
            "dispatched": false, "dismissed": false,
            "invitation_token": "u1:c1:14",
            "created_at": "2026-08-01T00:00:00Z"
        });
        apply_change(&conn, &change_row("reminder", "INSERT", "r1", data), "local-default")
            .expect("apply reminder");
        let (kind, token, contact_id): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT kind, invitation_token, contact_id FROM Reminder WHERE id='r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("query reminder");
        assert_eq!(kind, "cadence");
        assert_eq!(token, Some("u1:c1:14".to_string()), "invitation_token must round-trip through pull");
        assert_eq!(contact_id, Some("c1".to_string()));
    }

    #[test]
    fn pull_media_applies_storage_key_and_int_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Media (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                owner_type TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                mime TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                sha256 TEXT,
                filename TEXT,
                storage_key TEXT NOT NULL DEFAULT '',
                width INTEGER,
                height INTEGER,
                alt_text TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        let data = json!({
            "id": "m1", "user_id": "u1",
            "kind": "avatar", "owner_type": "contact", "owner_id": "c1",
            "mime": "image/webp", "size_bytes": 1234,
            "sha256": "abc", "filename": "a.webp",
            "storage_key": "u1/avatar/contact/c1/a.webp",
            "width": 100, "height": 100, "alt_text": null,
            "created_at": "2026-08-09T00:00:00Z",
            "updated_at": "2026-08-09T00:00:00Z"
        });
        apply_change(&conn, &change_row("media", "INSERT", "m1", data), "local-default")
            .expect("apply media");
        let (storage_key, width, height, size): (String, Option<i64>, Option<i64>, i64) = conn
            .query_row(
                "SELECT storage_key, width, height, size_bytes FROM Media WHERE id='m1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("query");
        assert_eq!(storage_key, "u1/avatar/contact/c1/a.webp");
        assert_eq!(width, Some(100));
        assert_eq!(height, Some(100));
        assert_eq!(size, 1234);
    }

    // Regression: a pulled DELETE on a junction table used to crash with
    // "no such column: deleted_at" because the soft-delete UPDATE assumed
    // every table has deleted_at. The fix branches on JUNCTION_TABLES and
    // hard-deletes with a composite-key or id-based WHERE clause.
    #[test]
    fn pull_delete_entity_link_uses_id_pk() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE EntityLink (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                from_type TEXT NOT NULL,
                from_id TEXT NOT NULL,
                to_type TEXT NOT NULL,
                to_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'participant',
                created_at TEXT NOT NULL,
                UNIQUE (user_id, from_type, from_id, to_type, to_id, relation_type)
            );
            INSERT INTO EntityLink(id, user_id, from_type, from_id, to_type, to_id, relation_type, created_at)
            VALUES ('el1', 'u1', 'contact', 'c1', 'event', 'e1', 'attendee', '2026-08-01T00:00:00Z');",
        )
        .unwrap();
        apply_change(
            &conn,
            &ChangeRow {
                kind: "entity_link".into(),
                op: "DELETE".into(),
                row_id: "el1".into(),
                data: None,
                revision: 2,
            },
            "u1",
        )
        .expect("delete entity_link");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM EntityLink", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "entity_link must be hard-deleted by id");
    }

    #[test]
    fn pull_delete_contact_tag_uses_composite_pk_with_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ContactTag (
                user_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY (contact_id, tag_id)
            );
            INSERT INTO ContactTag(user_id, contact_id, tag_id) VALUES ('u1', 'c1', 't1');
            INSERT INTO ContactTag(user_id, contact_id, tag_id) VALUES ('u1', 'c1', 't2');",
        )
        .unwrap();
        apply_change(
            &conn,
            &ChangeRow {
                kind: "contact_tag".into(),
                op: "DELETE".into(),
                row_id: "server-side-pg-id".into(),
                data: Some(json!({"user_id": "u1", "contact_id": "c1", "tag_id": "t1"})),
                revision: 2,
            },
            "u1",
        )
        .expect("delete contact_tag");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ContactTag", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "only t1 must be deleted; t2 survives");
        let remaining: String = conn
            .query_row("SELECT tag_id FROM ContactTag", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, "t2");
    }

    #[test]
    fn pull_delete_contact_tag_without_data_is_no_op_not_crash() {
        // Server's sync trigger currently sets v_data := NULL on DELETE.
        // Until that grows OLD.* capture, we can't resolve the composite
        // PK. Must log-and-skip rather than crash the pull tx.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ContactTag (
                user_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                tag_id TEXT NOT NULL,
                PRIMARY KEY (contact_id, tag_id)
            );
            INSERT INTO ContactTag(user_id, contact_id, tag_id) VALUES ('u1', 'c1', 't1');",
        )
        .unwrap();
        apply_change(
            &conn,
            &ChangeRow {
                kind: "contact_tag".into(),
                op: "DELETE".into(),
                row_id: "server-side-pg-id".into(),
                data: None,
                revision: 2,
            },
            "u1",
        )
        .expect("missing-data contact_tag DELETE must not crash");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ContactTag", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "row preserved (server trigger bug, not ours)");
    }

    #[test]
    fn pull_delete_project_contact_uses_composite_pk_with_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ProjectContact (
                user_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                role TEXT,
                added_at TEXT NOT NULL DEFAULT '2026-08-01T00:00:00Z',
                PRIMARY KEY (project_id, contact_id)
            );
            INSERT INTO ProjectContact(user_id, project_id, contact_id) VALUES ('u1', 'p1', 'c1');
            INSERT INTO ProjectContact(user_id, project_id, contact_id) VALUES ('u1', 'p1', 'c2');",
        )
        .unwrap();
        apply_change(
            &conn,
            &ChangeRow {
                kind: "project_contact".into(),
                op: "DELETE".into(),
                row_id: "server-side-pg-id".into(),
                data: Some(json!({"user_id": "u1", "project_id": "p1", "contact_id": "c1"})),
                revision: 2,
            },
            "u1",
        )
        .expect("delete project_contact");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ProjectContact", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let remaining: String = conn
            .query_row("SELECT contact_id FROM ProjectContact", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, "c2");
    }
}
