//! Desktop sync client for weavine v0.2.0b.
//!
//! Syncs local SQLite data to/from the cloud server using the sync API protocol.
//! Architecture: push-then-pull. Local changes are pushed to the server first,
//! then remote changes are pulled and applied locally.

mod api;
pub mod config;
mod keys;
mod translate;

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
}

// ── Public API ────────────────────────────────────────

/// Link this desktop to a cloud account.
///
/// Logs into the server, stores credentials in SyncState, and runs
/// an initial sync (push local data, pull remote data).
pub async fn link(
    conn: &Connection,
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

    // Mark last_revision as 0 so first pull gets everything
    config::set(conn, KEY_LAST_PULLED_REVISION, "0")?;

    // Run initial sync
    sync_once_with_conn(conn).await
}

/// Run a single sync cycle: push then pull.
pub async fn sync_once(conn: &Connection) -> anyhow::Result<SyncResult> {
    sync_once_with_conn(conn).await
}

/// Spawn a blocking thread that periodically runs `sync_once`.
///
/// Runs one cycle immediately, then sleeps `interval_secs` between cycles.
/// Each iteration re-checks `is_linked`: unlinked devices stay quiet,
/// devices linked later via `cloud_login` start syncing on the next tick.
pub fn spawn_periodic(db_path: std::path::PathBuf, interval_secs: u64) {
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
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

        let interval = std::time::Duration::from_secs(interval_secs);
        loop {
            if config::is_linked(&conn).unwrap_or(false) {
                rt.block_on(async {
                    match sync_once_with_conn(&conn).await {
                        Ok(r) => eprintln!(
                            "[sync] periodic: pushed={} pulled={} conflicts={}",
                            r.pushed, r.pulled, r.conflicts
                        ),
                        Err(e) => eprintln!("[sync] periodic failed: {e}"),
                    }
                });
            }
            std::thread::sleep(interval);
        }
    });
}

// ── Internal implementation ───────────────────────────

async fn sync_once_with_conn(conn: &Connection) -> anyhow::Result<SyncResult> {
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

    for kind in ENTITY_KINDS {
        let table = match kind_to_sqlite_table(kind) {
            Some(t) => t,
            None => continue,
        };

        let cols = push_columns(kind);
        if cols.is_empty() {
            continue;
        }

        // Build SELECT query
        let col_list = cols
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");

        let sql = format!(
            "SELECT {} FROM \"{}\" WHERE \"user_id\" = ?1",
            col_list, table
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[sync] push: prepare {kind} failed: {e}");
                continue;
            }
        };

        let rows: Vec<Value> = match stmt.query_map([local_user_id], |row| {
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

        // Inject cloud user_id, add PG id for junction tables
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

    let push_resp = api::push(server_url, access_token, device_id, entities).await?;
    result.pushed = push_resp.accepted.len();
    result.conflicts = push_resp.conflicts.len();
    Ok(push_resp.server_revision)
}

/// Pull remote changes and apply them locally.
async fn pull_all(
    conn: &Connection,
    server_url: &str,
    access_token: &str,
    result: &mut SyncResult,
) -> anyhow::Result<()> {
    let mut since = last_pulled_revision(conn)?;
    let local_user_id = "local-default";

    loop {
        let pull_resp = api::pull(server_url, access_token, since, 200).await?;

        for change in &pull_resp.rows {
            if let Err(e) = apply_change(conn, change, local_user_id) {
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

        // Save progress
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

/// Apply a single ChangeRow to the local SQLite database.
fn apply_change(
    conn: &Connection,
    change: &ChangeRow,
    local_user_id: &str,
) -> anyhow::Result<()> {
    let table = match kind_to_sqlite_table(&change.kind) {
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
            let cols = push_columns(&change.kind);
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

            let sql = format!(
                "INSERT OR REPLACE INTO \"{}\" ({}) VALUES ({})",
                table, col_list, ph_list
            );

            let mut stmt = conn.prepare(&sql)?;

            let bool_cols = boolean_columns(&change.kind);
            let null_int_cols = nullable_integer_columns(&change.kind);
            let zero_int_cols = default_zero_integer_columns(&change.kind);

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
                        let val = obj
                            .get(*col)
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        Box::new(val.to_string()) as Box<dyn rusqlite::types::ToSql>
                    }
                })
                .collect();

            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();

            stmt.execute(param_refs.as_slice())?;
        }
        "DELETE" => {
            conn.execute(
                &format!(
                    "DELETE FROM \"{}\" WHERE \"id\" = ?1 AND \"user_id\" = ?2",
                    table
                ),
                rusqlite::params![change.row_id, local_user_id],
            )?;
        }
        _ => {
            return Err(anyhow::anyhow!("unknown op: {}", change.op));
        }
    }

    Ok(())
}
