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

/// Wake-up channel for the periodic sync thread.
///
/// The loop otherwise sleeps a whole interval (30 min) between cycles, so a
/// write made just after a cycle finished waits that long before it even leaves
/// the device — and a second device then waits another interval to see it.
/// Without this, the worst-case propagation delay is 2 × interval.
///
/// Deliberately `std`-only: the waiter is a plain `std::thread` (see
/// `spawn_periodic`) driving its own runtime, so a `tokio::sync::Notify` would
/// not be reachable from it.
fn kick_pair() -> &'static (std::sync::Mutex<bool>, std::sync::Condvar) {
    static PAIR: std::sync::OnceLock<(std::sync::Mutex<bool>, std::sync::Condvar)> =
        std::sync::OnceLock::new();
    PAIR.get_or_init(|| (std::sync::Mutex::new(false), std::sync::Condvar::new()))
}

/// Ask the periodic sync thread to run a cycle now instead of waiting out its
/// interval. Safe from any thread; calls coalesce, so a burst of writes costs
/// one wake-up. No-op when sync is unlinked — the loop re-checks `is_linked`.
pub fn request_sync() {
    let (lock, cvar) = kick_pair();
    // A poisoned lock only means a previous holder panicked mid-notify; the
    // flag itself is a plain bool and still safe to set.
    if let Ok(mut pending) = lock.lock() {
        *pending = true;
    }
    cvar.notify_one();
}

/// Sleep up to `dur`, returning early when `request_sync` arrives.
///
/// The pre-wait check is load-bearing. The periodic thread spends most of its
/// wall-clock time *inside* a cycle, not inside this wait, and a kick that
/// arrives then has nobody to notify — `notify_one` with no waiter is dropped,
/// while `pending` stays set. `Condvar::wait_timeout` does **not** consult that
/// flag, so without the check below the very nudge that was meant to shorten
/// the gap would instead be swallowed and the loop would sleep out the whole
/// interval (30 min in the steady state, where a clean cycle pulls 0 rows).
///
/// Consuming the flag before waiting is also what keeps a kick from being lost
/// in the expiry race — the window between `wait_timeout` returning on timeout
/// and the flag being cleared.
fn wait_for_kick(dur: std::time::Duration) {
    let (lock, cvar) = kick_pair();
    let mut guard = match lock.lock() {
        Ok(g) => g,
        // Nothing can wake us reliably on a poisoned mutex; fall back to the
        // plain sleep so the loop keeps running.
        Err(_) => {
            std::thread::sleep(dur);
            return;
        }
    };
    // A kick landed while the previous cycle was still running. Consume it and
    // go straight into the next cycle.
    if *guard {
        *guard = false;
        return;
    }
    // `wait_timeout` may return spuriously; clearing the flag here makes that
    // cost one extra idempotent sync rather than swallowing a real nudge.
    let (mut guard, _) = cvar
        .wait_timeout(guard, dur)
        .unwrap_or_else(|e| e.into_inner());
    *guard = false;
}

/// Spawn a blocking thread that periodically runs `sync_once`.
///
/// Runs one cycle immediately, then waits `interval_secs` between cycles.
/// The wait ends early when `request_sync` is called (see `wait_for_kick`), so
/// a local write is not stuck behind the timer.
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
        // `busy_timeout` matters here more than anywhere: this thread writes the
        // same file as the UI's connection, and a kick can start a cycle while
        // the user's own write is still in flight.
        let _ = conn.execute_batch(crate::db::CONN_PRAGMAS);

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
                    wait_for_kick(followup);
                    continue;
                }
            }
            wait_for_kick(interval);
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
            sqlite_row_to_push_json(row, cols, kind)
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

        let mapped_rows = map_rows_for_push(kind, rows, cloud_user_id);

        if mapped_rows.is_empty() {
            continue;
        }

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
            if push_resp.server_revision > last_server_rev {
                last_server_rev = push_resp.server_revision;
            }
            for c in &push_resp.conflicts {
                eprintln!(
                    "[sync] conflict kind={} row_id={} reason={}",
                    c.kind, c.row_id, c.reason
                );
                result.conflict_details.push(c.clone());
                let _ = persist_sync_conflict(conn, c);
                let _ = record_push_retry(conn, c);
            }
        }
    }
    if push_conflicts > 0 {
        eprintln!(
            "[sync] {push_conflicts} row(s) rejected by the server; queued for retry, \
             watermark advanced so accepted rows are not re-sent"
        );
    }

    // The watermark advances even when rows were rejected.
    //
    // Holding it back — the previous behaviour — meant every later cycle
    // re-selected and re-sent *every* row written since the old watermark for
    // as long as a single row kept failing. On the server each re-sent row
    // costs a `SELECT updated_at` (the LWW comparison) even when the upsert is
    // then skipped as a no-op, and for the kinds without `updated_at` — tag,
    // interaction, reminder, the junction tables — there is no comparison at
    // all: the row is rewritten unconditionally and the change-log trigger
    // appends another entry. So one rejected row made the change log grow on
    // every single cycle, and the log is what the next pull has to walk.
    //
    // Rejected rows are not dropped. They are queued in `SyncPushRetries` and
    // re-sent by primary key with backoff (`push_due_retries`), which also
    // covers the transient case the held watermark used to mask by accident:
    // a row rejected because it referenced a parent that had not been pushed
    // yet.
    if !max_pushed_at.is_empty() && max_pushed_at != last_pushed_at {
        config::set(conn, KEY_LAST_PUSHED_AT, &max_pushed_at)?;
    }

    // Re-send what earlier cycles were told to retry.
    let retry_rev = push_due_retries(
        conn,
        server_url,
        access_token,
        cloud_user_id,
        device_id,
        result,
    )
    .await?;
    if retry_rev > last_server_rev {
        last_server_rev = retry_rev;
    }

    Ok(last_server_rev)
}

const PUSH_CHUNK_SIZE: usize = 500;

/// Incremental pull page size. The server caps a page at 1000 and every page
/// is a separate round-trip applied serially, so asking for the cap cuts the
/// number of round-trips by 5x compared to the previous 200 — on a large
/// backlog that is the difference between seconds and tens of seconds.
const PULL_PAGE_SIZE: i64 = 1000;

/// Snapshot page size (server caps at 1000 as well).
const SNAPSHOT_PAGE_SIZE: i64 = 1000;

/// Rebuild local state from the server's current state instead of replaying the
/// changelog.
///
/// Why this exists: `sync_change_log` holds one row per historical write, not
/// one per row, so catching up from revision 0 costs O(edits ever made). The
/// snapshot costs O(rows) — on a real account the difference between minutes
/// and seconds for a first sync on a phone. Archive/normal-churn heavy
/// accounts, whose log is inflated by every status change and by the
/// synthesized Interactions that archiving produces, are the worst affected.
///
/// Returns the revision to resume the incremental pull from, or 0 when the
/// server has no snapshot endpoint (older deployment) — the caller then keeps
/// the previous changelog-replay behaviour.
/// Local SQLite row → the JSON shape `push` sends.
///
/// Booleans and integers must be emitted as JSON `true`/`false` and numbers,
/// not strings: SQLite stores both as INTEGER/TEXT, and the server's
/// `jsonb_populate_record` rejects `"1"` for a boolean column with
/// `invalid input syntax for type boolean`, which would reject the whole row.
fn sqlite_row_to_push_json(
    row: &rusqlite::Row<'_>,
    cols: &[&str],
    kind: &str,
) -> rusqlite::Result<Value> {
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
                map.insert(col.to_string(), Value::Number(serde_json::Number::from(n)));
            }
        } else {
            let val: Option<String> = row.get(i).ok();
            if let Some(v) = val {
                map.insert(col.to_string(), Value::String(v));
            }
        }
    }
    Ok(Value::Object(map))
}

/// Turn raw SQLite rows into the wire payload: snake_case keys (already),
/// `user_id` forced to the cloud account, a generated `id` for junction tables
/// (PG requires one, SQLite does not have it), desktop-only columns stripped,
/// and the avatar metadata row filtered out.
fn map_rows_for_push(kind: &str, rows: Vec<Value>, cloud_user_id: &str) -> Vec<Value> {
    let mapped: Vec<Value> = rows
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

    // Avatar rows are synced as BYTES (upload_avatar posts the binary to
    // POST /api/media), not as metadata rows. Pushing the local metadata row
    // would overwrite the server's authoritative storage_key with a
    // desktop-local path and break the avatar on every other device (the
    // server's sync_contact_avatar trigger mirrors storage_key onto contact).
    // Deletions must still propagate, so keep rows that carry deleted_at.
    if kind == "media" {
        mapped
            .into_iter()
            .filter(|r| {
                r.get("kind").and_then(|v| v.as_str()) != Some("avatar")
                    || r.get("deleted_at").is_some()
            })
            .collect()
    } else {
        mapped
    }
}

/// How many times a row is re-sent before it is left alone.
const PUSH_RETRY_MAX_ATTEMPTS: i64 = 6;

/// Rows re-sent per cycle. Bounded so a pathological table cannot turn the
/// retry path into a second full push.
const PUSH_RETRY_BATCH: i64 = 200;

fn ensure_push_retry_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS \"SyncPushRetries\" (
            \"kind\"        TEXT NOT NULL,
            \"row_id\"      TEXT NOT NULL,
            \"attempts\"    INTEGER NOT NULL DEFAULT 0,
            \"next_try_at\" TEXT NOT NULL,
            \"reason\"      TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (\"kind\", \"row_id\")
        );",
    )
}

/// Queue a row the server rejected.
///
/// Only kinds that push incrementally are queued. A kind that is re-read and
/// re-sent in full every cycle needs no retry entry — which now means just the
/// four junction tables, the only kinds left without an `updated_at`.
///
/// This filter is why `tag` / `interaction` / `reminder` changed behaviour on
/// 2026-09-26: they used to recover from a rejection implicitly, by being
/// re-sent in full on the very next cycle. Now that they push incrementally
/// they are retried by primary key with backoff like every other LWW kind.
fn record_push_retry(conn: &Connection, c: &Conflict) -> rusqlite::Result<()> {
    if c.row_id.is_empty() || !UPDATED_AT_TABLES.contains(&c.kind.as_str()) {
        // Nothing to address a retry at. It stays in `SyncConflicts` for the UI.
        return Ok(());
    }
    ensure_push_retry_table(conn)?;
    let attempts: i64 = conn
        .query_row(
            "SELECT \"attempts\" FROM \"SyncPushRetries\" WHERE \"kind\" = ?1 AND \"row_id\" = ?2",
            rusqlite::params![&c.kind, &c.row_id],
            |r| r.get(0),
        )
        .unwrap_or(0)
        + 1;
    // Backoff ladder: 1m, 5m, 15m, 1h, then 6h. A row rejected for a permanent
    // reason (bad timestamp format, a constraint that will never hold) keeps
    // failing but stops costing a request on every single cycle.
    let delay_secs: i64 = match attempts {
        1 => 60,
        2 => 300,
        3 => 900,
        4 => 3600,
        _ => 21600,
    };
    conn.execute(
        "INSERT INTO \"SyncPushRetries\"
             (\"kind\", \"row_id\", \"attempts\", \"next_try_at\", \"reason\")
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?4), ?5)
         ON CONFLICT(\"kind\", \"row_id\") DO UPDATE SET
             \"attempts\"    = excluded.\"attempts\",
             \"next_try_at\" = excluded.\"next_try_at\",
             \"reason\"      = excluded.\"reason\"",
        rusqlite::params![
            &c.kind,
            &c.row_id,
            attempts,
            format!("+{delay_secs} seconds"),
            &c.reason
        ],
    )?;
    // Give up on rows that have exhausted the ladder so a permanently bad row
    // cannot grow this table without bound. It remains in `SyncConflicts`,
    // which the UI can surface.
    conn.execute(
        "DELETE FROM \"SyncPushRetries\" WHERE \"attempts\" > ?1",
        rusqlite::params![PUSH_RETRY_MAX_ATTEMPTS],
    )?;
    Ok(())
}

fn clear_push_retry(conn: &Connection, kind: &str, row_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM \"SyncPushRetries\" WHERE \"kind\" = ?1 AND \"row_id\" = ?2",
        rusqlite::params![kind, row_id],
    )?;
    Ok(())
}

/// Read rows for the retry path, addressed by primary key.
///
/// Returns `None` when the kind is not pushable (unknown kind, or no columns),
/// which the caller treats as "drop the queued ids". Every kind that reaches
/// here has an `id` column: `record_push_retry` only queues kinds listed in
/// `UPDATED_AT_TABLES`, and the junction tables — which lack a local `id` —
/// are excluded there.
fn read_rows_by_ids(conn: &Connection, kind: &str, ids: &[String]) -> Option<Vec<Value>> {
    let table = kind_to_sqlite_table(kind)?;
    let cols = push_columns(kind);
    if cols.is_empty() || ids.is_empty() {
        return None;
    }
    let col_list = cols
        .iter()
        .map(|c| format!("\"{}\"", c))
        .collect::<Vec<_>>()
        .join(", ");
    // Bind the ids inline as `?1..?n`, and the local user id as the last one.
    let placeholders = (1..=ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {col_list} FROM \"{table}\" WHERE \"id\" IN ({placeholders}) \
         AND \"user_id\" = ?{}",
        ids.len() + 1
    );

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[sync] retry: prepare {kind} failed: {e}");
            return None;
        }
    };
    let mut params: Vec<&dyn rusqlite::types::ToSql> = Vec::with_capacity(ids.len() + 1);
    for id in ids {
        params.push(id);
    }
    let local_user_id = "local-default";
    params.push(&local_user_id);

    let rows = match stmt.query_map(rusqlite::params_from_iter(params), |row| {
        sqlite_row_to_push_json(row, cols, kind)
    }) {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(e) => {
            eprintln!("[sync] retry: query {kind} failed: {e}");
            return None;
        }
    };
    Some(rows)
}

/// Re-send rows the server previously rejected, addressed by primary key.
///
/// This is what makes advancing the push watermark safe. It recovers the
/// transient case — a row refused because it referenced a parent not yet
/// pushed — and rows the user has since fixed. Rows rejected for a permanent
/// reason simply exhaust their attempts; they stay in `SyncConflicts`.
///
/// Returns the highest server revision observed, so the caller can keep its
/// revision bookkeeping accurate.
async fn push_due_retries(
    conn: &Connection,
    server_url: &str,
    access_token: &str,
    cloud_user_id: &str,
    device_id: &str,
    result: &mut SyncResult,
) -> anyhow::Result<i64> {
    if ensure_push_retry_table(conn).is_err() {
        return Ok(0);
    }
    let due: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT \"kind\", \"row_id\" FROM \"SyncPushRetries\" \
             WHERE \"next_try_at\" <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now') \
             ORDER BY \"next_try_at\" LIMIT ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![PUSH_RETRY_BATCH], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if due.is_empty() {
        return Ok(0);
    }

    // One request carries every due row of a kind.
    let mut by_kind: Vec<(String, Vec<String>)> = Vec::new();
    for (kind, row_id) in due {
        match by_kind.iter_mut().find(|(k, _)| *k == kind) {
            Some((_, ids)) => ids.push(row_id),
            None => by_kind.push((kind, vec![row_id])),
        }
    }

    let mut last_server_rev = 0;
    for (kind, ids) in by_kind {
        let rows = match read_rows_by_ids(conn, &kind, &ids) {
            Some(r) => r,
            None => {
                // Unknown kind or unpushable: nothing to send, drop the queue.
                for id in &ids {
                    let _ = clear_push_retry(conn, &kind, id);
                }
                continue;
            }
        };
        // Ids that no longer resolve are rows deleted at the source (or already
        // pushed under a different key): stop retrying them.
        let present: std::collections::HashSet<&str> = rows
            .iter()
            .filter_map(|r| r.get("id").and_then(|v| v.as_str()))
            .collect();
        for id in &ids {
            if !present.contains(id.as_str()) {
                let _ = clear_push_retry(conn, &kind, id);
            }
        }
        let mapped = map_rows_for_push(&kind, rows, cloud_user_id);
        if mapped.is_empty() {
            for id in &ids {
                let _ = clear_push_retry(conn, &kind, id);
            }
            continue;
        }

        for chunk_rows in mapped.chunks(PUSH_CHUNK_SIZE) {
            let resp = api::push(
                server_url,
                access_token,
                device_id,
                vec![EntityPush {
                    kind: kind.clone(),
                    rows: chunk_rows.to_vec(),
                }],
            )
            .await?;
            result.pushed += resp.accepted.len();
            result.conflicts += resp.conflicts.len();
            if resp.server_revision > last_server_rev {
                last_server_rev = resp.server_revision;
            }

            // `accepted` is `"{kind}:{row_id}"`. Anything we sent that came back
            // neither accepted nor conflicting is left queued on purpose: the
            // queued entry is what increments the attempt counter, so clearing
            // it first would reset the backoff and retry a permanently bad row
            // every minute forever.
            let rejected: std::collections::HashSet<&str> = resp
                .conflicts
                .iter()
                .map(|c| c.row_id.as_str())
                .collect();
            for accepted_entry in &resp.accepted {
                if let Some((_, id)) = accepted_entry.split_once(':') {
                    if !rejected.contains(id) {
                        let _ = clear_push_retry(conn, &kind, id);
                    }
                }
            }
            for c in &resp.conflicts {
                eprintln!(
                    "[sync] retry conflict kind={} row_id={} reason={}",
                    c.kind, c.row_id, c.reason
                );
                result.conflict_details.push(c.clone());
                let _ = persist_sync_conflict(conn, c);
                let _ = record_push_retry(conn, c);
            }
        }
    }
    Ok(last_server_rev)
}

/// Rebuild local state from the server's current state instead of replaying the
/// changelog.
///
/// Returns `Some(revision)` — the cursor to resume the incremental pull from —
/// or `None` when the server has no snapshot endpoint (an older deployment), in
/// which case the caller keeps the previous changelog-replay behaviour.
///
/// The `Option` (rather than the `0` sentinel it used to return) is what makes
/// the "pruned past our cursor" recovery in `pull_all` safe to retry: `0` is a
/// legitimate cursor value, so the caller could not tell "bootstrapped from the
/// start" from "no endpoint, nothing happened" — and would re-enter the
/// bootstrap branch forever on a server that has a prune watermark but no
/// snapshot route.
async fn bootstrap_from_snapshot(
    conn: &mut Connection,
    server_url: &str,
    access_token: &str,
    local_user_id: &str,
    result: &mut SyncResult,
) -> anyhow::Result<Option<i64>> {
    // Taken from the FIRST page and kept. Every row applied was read by a query
    // that started at or after that sample, and any write after it carries a
    // higher revision, so resuming from it can re-deliver changes (idempotent
    // upserts) but can never skip one.
    let mut resume_revision: Option<i64> = None;

    for kind in ENTITY_KINDS {
        let mut cursor: Option<String> = None;
        loop {
            let page = match api::snapshot(
                server_url,
                access_token,
                kind,
                cursor.clone(),
                SNAPSHOT_PAGE_SIZE,
            )
            .await
            {
                Ok(p) => p,
                Err(e) => {
                    if resume_revision.is_none() && e.to_string().contains("404") {
                        eprintln!(
                            "[sync] snapshot endpoint unavailable, falling back to changelog replay: {e}"
                        );
                        return Ok(None);
                    }
                    return Err(e);
                }
            };
            if resume_revision.is_none() {
                resume_revision = Some(page.server_revision);
            }

            if !page.rows.is_empty() {
                let tx = conn.transaction()?;
                for row in &page.rows {
                    let change = ChangeRow {
                        kind: page.kind.clone(),
                        op: "INSERT".to_string(),
                        row_id: row
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        data: Some(row.clone()),
                        revision: page.server_revision,
                    };
                    match apply_change(&tx, &change, local_user_id) {
                        Ok(()) => result.pulled += 1,
                        Err(e) => {
                            eprintln!(
                                "[sync] snapshot apply {} {} failed: {}",
                                change.kind, change.row_id, e
                            );
                            let _ = persist_sync_conflict(
                                &tx,
                                &Conflict {
                                    kind: change.kind.clone(),
                                    row_id: change.row_id.clone(),
                                    reason: format!("snapshot apply failed: {e}"),
                                },
                            );
                        }
                    }
                }
                tx.commit()?;
            }

            match (page.has_more, page.next_cursor) {
                (true, Some(next)) => cursor = Some(next),
                _ => break,
            }
        }
    }

    let revision = resume_revision.unwrap_or(0);
    config::set(conn, KEY_LAST_PULLED_REVISION, &revision.to_string())?;
    eprintln!("[sync] bootstrap from snapshot complete, cursor at revision {revision}");
    Ok(Some(revision))
}

/// Pull remote changes and apply them locally.
async fn pull_all(
    conn: &mut Connection,
    server_url: &str,
    access_token: &str,
    result: &mut SyncResult,
) -> anyhow::Result<()> {
    let mut since = last_pulled_revision(conn)?;
    let local_user_id = "local-default";

    // Name ourselves so the server withholds the changes we authored. `sync_once`
    // pushes before it pulls, so without this every row just uploaded comes
    // straight back and is replayed through `apply_change` one by one — the
    // expensive half of the round trip that the server's no-op trigger guard
    // cannot address (it stops rows being logged *again*, not the first copy
    // returning to its author).
    //
    // An empty id — a fresh install that has not registered yet — is sent as
    // absent, which the server reads as "no filter".
    let device_id = config::get(conn, KEY_DEVICE_ID)?.unwrap_or_default();
    let device_id = if device_id.is_empty() {
        None
    } else {
        Some(device_id.as_str())
    };

    // Cursor 0 = nothing has ever been pulled on this device. Replaying the
    // changelog from revision 0 is the slow path (see
    // `bootstrap_from_snapshot`), so take the snapshot instead.
    //
    // Set when the server has no snapshot route at all. Every recovery that
    // depends on the snapshot has to stand down afterwards: retrying it would
    // re-enter this branch on each pass without ever making progress (see the
    // prune guard below).
    let mut snapshot_unavailable = false;
    if since == 0 {
        match bootstrap_from_snapshot(conn, server_url, access_token, local_user_id, result).await? {
            Some(revision) => since = revision,
            None => snapshot_unavailable = true,
        }
    }

    loop {
        let pull_resp =
            api::pull(server_url, access_token, since, PULL_PAGE_SIZE, device_id).await?;

        // The log no longer reaches back to our cursor — it was pruned by age
        // while this device was away. Carrying on would look like "no changes"
        // and silently drop every write in the window, so rebuild from the
        // snapshot instead. (`server_revision` in a snapshot is floored at the
        // prune mark, so the restarted pull cannot re-trigger this branch.)
        //
        // The guard matters: that "cannot re-trigger" argument holds only when
        // the bootstrap actually ran. A server with a prune watermark but no
        // snapshot route would return `None`, leave `since` below the mark, and
        // have this branch re-fire the bootstrap on every pass — an infinite
        // loop hammering the endpoint, from a background thread, forever. A
        // deployment like that is close to impossible (the column and the route
        // ship in the same release), but the failure mode is bad enough to be
        // worth one bool: without the snapshot there is no way to close the gap,
        // so the only sane move is to carry on with the changelog we can still
        // read and say so.
        if !snapshot_unavailable && pull_resp.pruned_through_revision > since {
            eprintln!(
                "[sync] changelog pruned past our cursor ({since} < {}), bootstrapping",
                pull_resp.pruned_through_revision
            );
            match bootstrap_from_snapshot(conn, server_url, access_token, local_user_id, result)
                .await?
            {
                Some(revision) => {
                    since = revision;
                    continue;
                }
                None => {
                    snapshot_unavailable = true;
                    eprintln!(
                        "[sync] snapshot endpoint unavailable — the pruned gap (cursor {since}, \
                         pruned through {}) cannot be closed on this server; continuing from the \
                         changelog that still exists. Rows deleted inside the gap may be missed.",
                        pull_resp.pruned_through_revision
                    );
                }
            }
        }

        let tx = conn.transaction()?;
        for change in &pull_resp.rows {
            if let Err(e) = apply_change(&tx, change, local_user_id) {
                // Surface it and keep going. The old behaviour advanced the
                // cursor after a bare `eprintln!`, losing the row with no
                // trace; stalling instead is worse — one unappliable row would
                // freeze the whole device — so the failure becomes a conflict
                // the UI can show (SyncConflicts) and the cursor advances.
                eprintln!(
                    "[sync] apply {} {} failed: {}",
                    change.kind, change.row_id, e
                );
                let _ = persist_sync_conflict(
                    &tx,
                    &Conflict {
                        kind: change.kind.clone(),
                        row_id: change.row_id.clone(),
                        reason: format!("local apply failed: {e}"),
                    },
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

    // Avatar binaries self-heal in both directions: metadata rows sync via
    // push/pull, but the bytes only move over the media endpoints. Upload what
    // this device has and the server does not, then download what the server
    // has and this device does not. Both passes are cheap when there is nothing
    // to do (a single indexed query) and never fatal.
    // Desktop-only: reads/writes the local data_dir via commands::media.
    #[cfg(feature = "tauri")]
    {
        upload_pending_avatars(conn, server_url, access_token).await;
        backfill_avatar_bytes(conn, server_url, access_token).await;
    }

    Ok(())
}

/// Upload avatar binaries that are on this device but not confirmed on the
/// server yet.
///
/// This is what lets `upload_avatar` return immediately. The command writes the
/// file and the `Media` row locally and leaves `bytes_uploaded_at` NULL; this
/// pass does the network work. It runs both from the background kick the command
/// fires and from every sync cycle, so a failure converges instead of being lost
/// — previously the command awaited the upload itself (blocking the UI for up to
/// the 30 s HTTP timeout when the server was unreachable) and a failure was only
/// retried if the user happened to change that same avatar again.
#[cfg(feature = "tauri")]
async fn upload_pending_avatars(conn: &Connection, server_url: &str, access_token: &str) -> usize {
    if server_url.is_empty() || access_token.is_empty() {
        return 0;
    }
    let rows: Vec<(String, String, String, String)> = match conn.prepare(
        "SELECT id, storage_key, COALESCE(mime, 'image/jpeg'), COALESCE(owner_id, '') \
         FROM \"Media\" \
         WHERE kind='avatar' AND deleted_at IS NULL \
           AND bytes_uploaded_at IS NULL \
           AND storage_key IS NOT NULL AND storage_key != ''",
    ) {
        Ok(mut stmt) => match stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        }) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                eprintln!("[sync] avatar upload query failed: {e}");
                return 0;
            }
        },
        Err(e) => {
            eprintln!("[sync] avatar upload prepare failed: {e}");
            return 0;
        }
    };
    if rows.is_empty() {
        return 0;
    }
    let base = match crate::commands::media::data_dir() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[sync] avatar upload: data_dir: {e}");
            return 0;
        }
    };
    let mut uploaded = 0usize;
    for (id, key, mime, owner_id) in rows {
        if key.contains("..") || std::path::Path::new(&key).is_absolute() {
            continue;
        }
        let path = base.join(&key);
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            // Binary not on this device: this row's avatar came from another
            // device. `backfill_avatar_bytes` downloads it and marks it
            // uploaded, since the server is the one that has the bytes.
            Err(_) => continue,
        };
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("avatar")
            .to_string();
        match api::upload_media_bytes(
            server_url,
            access_token,
            "avatar",
            "contact",
            &owner_id,
            &mime,
            &filename,
            bytes,
        )
        .await
        {
            Ok(_) => {
                let _ = conn.execute(
                    "UPDATE \"Media\" SET bytes_uploaded_at = \
                     strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
                    rusqlite::params![&id],
                );
                uploaded += 1;
            }
            // Deliberately left NULL so the next cycle retries.
            Err(e) => eprintln!("[sync] avatar upload {id} failed (retried next sync): {e}"),
        }
    }
    if uploaded > 0 {
        eprintln!("[sync] avatar upload: {uploaded} binary(ies) pushed");
    }
    uploaded
}

/// Start a one-shot avatar upload in the background.
///
/// Called by `upload_avatar` so the avatar reaches the user's other devices
/// promptly without making the caller wait for the network.
///
/// Runs on its own thread with its own runtime and its own connection rather
/// than as a spawned task: `rusqlite::Connection` is not `Send`, so a future
/// that holds one across an `await` cannot be spawned onto the shared
/// multi-threaded runtime (same reason `spawn_periodic` owns its connection).
/// The connection is opened here instead of borrowing the shared `Database`
/// mutex, because the command has already returned by the time this runs.
///
/// If it fails, the next sync cycle runs the same pass and retries.
#[cfg(feature = "tauri")]
pub fn spawn_pending_avatar_upload() {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[sync] avatar upload: create runtime: {e}");
                return;
            }
        };
        let path = crate::db::get_db_path();
        let conn = match rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        ) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[sync] avatar upload: open db: {e}");
                return;
            }
        };
        let _ = conn.execute_batch(crate::db::CONN_PRAGMAS);
        let server_url = config::get(&conn, KEY_SERVER_URL)
            .ok()
            .flatten()
            .unwrap_or_default();
        let access_token = config::get(&conn, KEY_ACCESS_TOKEN)
            .ok()
            .flatten()
            .unwrap_or_default();
        rt.block_on(upload_pending_avatars(&conn, &server_url, &access_token));
    });
}

/// Ensure every avatar Media row has its binary present at
/// `data_dir/{storage_key}`. Missing bytes are fetched from
/// `GET /api/media/{id}/blob` (server-authoritative storage). Failures are
/// logged and retried on the next sync cycle — never fatal.
#[cfg(feature = "tauri")]
async fn backfill_avatar_bytes(conn: &Connection, server_url: &str, access_token: &str) {
    let rows: Vec<(String, String)> = match conn.prepare(
        "SELECT id, storage_key FROM \"Media\" \
         WHERE kind='avatar' AND deleted_at IS NULL \
           AND storage_key IS NOT NULL AND storage_key != ''",
    ) {
        Ok(mut stmt) => match stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) {
            Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                eprintln!("[sync] avatar backfill query failed: {e}");
                return;
            }
        },
        Err(e) => {
            eprintln!("[sync] avatar backfill prepare failed: {e}");
            return;
        }
    };
    if rows.is_empty() {
        return;
    }
    let base = match crate::commands::media::data_dir() {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[sync] avatar backfill: data_dir: {e}");
            return;
        }
    };
    let mut fetched = 0usize;
    for (id, key) in rows {
        // Defensive: storage_key is a relative path fragment; reject anything
        // that could escape data_dir (PathBuf::join replaces the base on
        // absolute inputs).
        if key.contains("..") || std::path::Path::new(&key).is_absolute() {
            continue;
        }
        let path = base.join(&key);
        if path.exists() {
            continue;
        }
        match api::get_media_blob(server_url, access_token, &id).await {
            Ok(bytes) => {
                if let Some(parent) = path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        eprintln!("[sync] avatar mkdir {}: {e}", path.display());
                        continue;
                    }
                }
                match std::fs::write(&path, &bytes) {
                    Ok(_) => {
                        // The server just served these bytes, so it obviously
                        // has them: mark the row uploaded or the next cycle
                        // would push back what we only just downloaded.
                        let _ = conn.execute(
                            "UPDATE \"Media\" SET bytes_uploaded_at = \
                             strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
                            rusqlite::params![&id],
                        );
                        fetched += 1;
                        eprintln!("[sync] avatar bytes downloaded: {key}");
                    }
                    Err(e) => eprintln!("[sync] avatar write {}: {e}", path.display()),
                }
            }
            Err(e) => {
                // Row without server bytes (e.g. avatar uploaded offline, or
                // deleted remotely) — retried next cycle, never fatal.
                eprintln!("[sync] avatar download {id} failed: {e}");
            }
        }
    }
    if fetched > 0 {
        eprintln!("[sync] avatar backfill: {fetched} file(s) fetched");
    }
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
                // Not every synced table carries `updated_at`: Tag, Interaction
                // and Reminder have only `created_at` + `deleted_at` — exactly
                // the kinds missing from `UPDATED_AT_TABLES`. Writing the column
                // unconditionally made the statement fail with
                // "no such column: updated_at" the first time a delete for one
                // of those kinds arrived, which aborted the *entire* pull
                // transaction: a single deleted reminder silently stopped every
                // later change from landing on that device.
                //
                // A tombstone is carried by `deleted_at` alone for these tables
                // (they are likewise absent from `UPDATED_AT_TABLES`, so push
                // never time-filters them and the tombstone still propagates).
                let set_clause = if UPDATED_AT_TABLES.contains(&kind) {
                    "\"deleted_at\" = ?1, \"updated_at\" = ?1"
                } else {
                    "\"deleted_at\" = ?1"
                };
                conn.execute(
                    &format!(
                        "UPDATE \"{}\" SET {} \
                         WHERE \"id\" = ?2 AND \"user_id\" = ?3 AND \"deleted_at\" IS NULL",
                        table, set_clause
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
            // `deleted_at` is not optional here: `apply_change` builds its column
            // list from `push_columns(kind)`, which has included `deleted_at` for
            // contact and project since soft deletes were introduced. Omitting
            // the column from this fixture made the INSERT fail with
            // "no such column: deleted_at" — the tests below could not pass no
            // matter what the code did.
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
                updated_at TEXT NOT NULL,
                deleted_at TEXT
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
                archived_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
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

    /// A nudge that arrives while a cycle is running must not be swallowed.
    ///
    /// `request_sync` sets `pending` and notifies, but if the sync thread is
    /// mid-cycle there is no waiter to receive the notification. `Condvar::
    /// wait_timeout` never inspects the flag, so a `wait_for_kick` that only
    /// checks it *after* waiting would sleep out the full interval — 30 minutes
    /// in the steady state, where a clean cycle pulls 0 rows. The write that
    /// triggered the nudge would sit on the device until the timer, which is
    /// precisely the delay the write-triggered sync exists to remove.
    ///
    /// Fails loudly if the pre-wait check is dropped: this would block for the
    /// full 30 s and trip the assertion instead of returning immediately.
    #[test]
    fn wait_for_kick_consumes_a_kick_that_arrived_before_the_wait() {
        request_sync();
        let started = std::time::Instant::now();
        wait_for_kick(std::time::Duration::from_secs(30));
        let waited = started.elapsed();
        assert!(
            waited < std::time::Duration::from_secs(2),
            "wait_for_kick slept {waited:?} despite a kick already pending — a \
             nudge that lands during a cycle would be lost"
        );
        // And it must have consumed the kick: the *next* wait is allowed to
        // block normally (asserted only loosely, to stay non-flaky).
        let started = std::time::Instant::now();
        wait_for_kick(std::time::Duration::from_millis(150));
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(100),
            "the resolved kick must be cleared, not left pending"
        );
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

    // (The old `push_columns_includes_archived_at` test lived here and checked
    // `project` alone. It is superseded by `column_lists_agree_with_real_schema`,
    // which asserts the same invariant for *every* kind whose table carries
    // `archived_at`, against the real migration. Checking one hand-picked kind is
    // exactly how `contact` slipped through with the column present on both sides
    // and listed in neither push list.)
    /// Pins the contents of the list.
    ///
    /// The server keeps a mirror of it (server/src/handlers/sync.rs) and the two
    /// must move together. A kind that is incremental on one side only is a
    /// quiet regression: incremental on the client but not the server means the
    /// server skips the LWW comparison and lets a stale row overwrite a newer
    /// one; incremental on the server but not the client means the client
    /// re-uploads that whole table every cycle forever. Making this list fail
    /// loudly when it changes is the reminder to go update the other side.
    #[test]
    fn updated_at_tables_is_the_expected_set() {
        let mut got: Vec<&str> = UPDATED_AT_TABLES.to_vec();
        got.sort_unstable();
        assert_eq!(
            got,
            vec![
                "action", "contact", "event", "interaction", "media", "note",
                "project", "reminder", "setting", "tag",
            ],
            "UPDATED_AT_TABLES changed — mirror the server's copy in \
             server/src/handlers/sync.rs"
        );
    }

    /// A row predating the `updated_at` column must come out of the migration
    /// with a non-NULL value.
    ///
    /// `push_all` selects with `WHERE updated_at > <watermark>`, and SQLite
    /// never returns a row from that comparison when the column is NULL. A
    /// pre-existing row left NULL would therefore silently stop syncing the
    /// moment this shrank: no error, no conflict, it simply never appears in a
    /// push again. `migration::run` is called on a table that already exists in
    /// the legacy shape, which is what a real upgrade looks like.
    #[test]
    fn migration_backfills_updated_at_on_predating_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Tag (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at TEXT
            );
            INSERT INTO Tag (id, user_id, name) VALUES ('t-legacy', 'u1', 'vip');",
        )
        .unwrap();

        crate::migration::run(&conn).expect("run migrations");

        let updated: Option<String> = conn
            .query_row(
                "SELECT updated_at FROM Tag WHERE id = 't-legacy'",
                [],
                |r| r.get(0),
            )
            .expect("query updated_at");
        assert_eq!(
            updated.as_deref(),
            Some(crate::business::LWW_SENTINEL),
            "a pre-existing row must not be left NULL — the push filter would \
             never select it again"
        );
    }

    /// The two lists that drive incremental sync must agree with the real
    /// schema.
    ///
    /// `push_columns` is the column list behind both `push_all` and
    /// `apply_change`, so naming a column its table does not have is this
    /// project's most repeated crash — "no such column: updated_at" has been
    /// fixed six separate times, and each instance broke a whole feature
    /// (deleting an avatar, an interaction, a reminder, an event, a tag).
    ///
    /// `UPDATED_AT_TABLES` is what makes a push incremental. Listing a kind
    /// whose table lacks the column breaks the per-cycle query; omitting a
    /// table that *does* have one silently re-uploads that entire table on
    /// every sync, which is precisely the waste the list exists to prevent.
    ///
    /// This runs the real migration rather than a hand-written fixture so the
    /// assertion and the shipped schema cannot drift apart.
    #[test]
    fn column_lists_agree_with_real_schema() {
        let conn = Connection::open_in_memory().unwrap();
        crate::migration::run(&conn).expect("run migrations");

        let has_col = |table: &str, col: &str| -> bool {
            conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
                rusqlite::params![table, col],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
                > 0
        };

        for kind in ENTITY_KINDS {
            let table = match kind_to_sqlite_table(kind) {
                Some(t) => t,
                None => continue,
            };

            for col in push_columns(kind) {
                assert!(
                    has_col(table, col),
                    "push_columns(\"{kind}\") names \"{col}\", but \"{table}\" has no \
                     such column — push and pull both build their SQL from this list"
                );
            }

            if UPDATED_AT_TABLES.contains(kind) {
                assert!(
                    has_col(table, "updated_at"),
                    "\"{kind}\" is in UPDATED_AT_TABLES, so push filters on \
                     updated_at, but \"{table}\" has no such column"
                );
            } else {
                assert!(
                    !has_col(table, "updated_at"),
                    "\"{table}\" has an updated_at column but \"{kind}\" is not in \
                     UPDATED_AT_TABLES, so every push re-uploads the whole table. \
                     Either list it (and maintain the column at every write site) \
                     or drop the column."
                );
            }

            // The same invariant for `archived_at`, and it is not hypothetical:
            // every archived-capable table (event / action / project / note) had
            // the column in its push list except `contact`, which had the column
            // on both sides and synced neither — so an archived contact stayed
            // live on the other device, and the server's retention sweep (which
            // keys entirely on `archived_at`) could never fire for one.
            //
            // Unlike `updated_at` there is no reverse assertion to make: a kind
            // without the column simply has no archive state to carry, and
            // `push_columns` naming a column the table lacks is already caught
            // above.
            if has_col(table, "archived_at") {
                assert!(
                    push_columns(kind).contains(&"archived_at"),
                    "\"{table}\" has an archived_at column but push_columns(\"{kind}\") \
                     omits it — archiving on this device never reaches the server, never \
                     comes back from it, and is invisible to the retention sweep"
                );
            }
        }
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
                created_at TEXT NOT NULL,
                updated_at TEXT,
                deleted_at TEXT
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
                updated_at TEXT NOT NULL,
                deleted_at TEXT
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

    // Regression: the soft-delete UPDATE in `apply_change` writes `updated_at`
    // for every kind listed in `UPDATED_AT_TABLES`. Back when Tag / Interaction
    // / Reminder lacked the column, the first pulled DELETE for one of them
    // raised "no such column: updated_at" and aborted the whole pull
    // transaction — one deleted reminder silently stopped every later change
    // from ever reaching that device.
    //
    // As of 2026-09-26 those three tables *do* carry the column (they are
    // pushed incrementally now), so this test pins both halves of the contract:
    // the tombstone lands, and `updated_at` moves with it. A tombstone that
    // left `updated_at` stale would sit below the push watermark and never be
    // delivered to other devices.
    //
    // This matters much more now that contact is inside the archive retention
    // sweep: deleting a contact cascades into its Reminder rows, so a single
    // expired contact produces a burst of reminder DELETEs.
    #[test]
    fn pull_delete_marks_tombstone_and_bumps_updated_at() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Tag (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                deleted_at TEXT
            );
            CREATE TABLE Interaction (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                contact_id TEXT,
                occurred_at TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                deleted_at TEXT
            );
            CREATE TABLE Reminder (
                id TEXT NOT NULL PRIMARY KEY,
                user_id TEXT NOT NULL,
                contact_id TEXT,
                trigger_at TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'time',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                deleted_at TEXT
            );
            INSERT INTO Tag VALUES ('t1', 'u1', 'vip', NULL, '2026-08-01T00:00:00Z', '1970-01-01T00:00:00.000Z', NULL);
            INSERT INTO Interaction VALUES ('i1', 'u1', 'c1', '2026-08-01T00:00:00Z', 'met', '2026-08-01T00:00:00Z', '1970-01-01T00:00:00.000Z', NULL);
            INSERT INTO Reminder VALUES ('r1', 'u1', 'c1', '2026-08-01T00:00:00Z', 'time', '2026-08-01T00:00:00Z', '1970-01-01T00:00:00.000Z', NULL);",
        )
        .unwrap();

        for (kind, row_id) in [("tag", "t1"), ("interaction", "i1"), ("reminder", "r1")] {
            apply_change(
                &conn,
                &ChangeRow {
                    kind: kind.into(),
                    op: "DELETE".into(),
                    row_id: row_id.into(),
                    data: None,
                    revision: 2,
                },
                "u1",
            )
            .unwrap_or_else(|e| panic!("pull DELETE for {kind} failed: {e}"));
        }

        for (table, id) in [("Tag", "t1"), ("Interaction", "i1"), ("Reminder", "r1")] {
            let (tombstone, updated): (Option<String>, Option<String>) = conn
                .query_row(
                    &format!("SELECT deleted_at, updated_at FROM \"{table}\" WHERE id = ?1"),
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or_else(|e| panic!("query {table}: {e}"));
            assert!(
                tombstone.is_some(),
                "{table} must carry a tombstone after DELETE"
            );
            assert_ne!(
                updated.as_deref(),
                Some(crate::business::LWW_SENTINEL),
                "{table}.updated_at must advance with the tombstone, or the \
                 delete sits below the push watermark and never propagates"
            );
        }
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
