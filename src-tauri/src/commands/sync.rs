//! Tauri commands for cloud sync — login, logout, status, manual sync.
//!
//! Async commands run blocking sync work via `spawn_blocking` so the future
//! stays Send — rusqlite::Connection is !Send, can't be held across `.await`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::db::Database;
use crate::sync;

#[derive(Debug, Serialize)]
pub struct CloudStatus {
    pub linked: bool,
    pub server_url: Option<String>,
    pub user_email: Option<String>,
    pub last_pulled_revision: i64,
    pub last_pushed_revision: i64,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cloud_login(
    app: AppHandle,
    server_url: String,
    email: String,
    password: String,
) -> Result<CloudStatus, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db().map_err(|e| e.to_string())?;
        let rt = new_current_thread_runtime().map_err(|e| e.to_string())?;
        rt.block_on(sync::link(&mut conn, &server_url, &email, &password))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("sync thread panicked: {e}"))??;

    eprintln!(
        "[sync] initial sync done: pushed={} pulled={} conflicts={}",
        result.pushed, result.pulled, result.conflicts
    );
    for c in &result.conflict_details {
        eprintln!(
            "[sync] conflict kind={} row_id={} reason={}",
            c.kind, c.row_id, c.reason
        );
    }
    if !result.conflict_details.is_empty() {
        let payload: Vec<serde_json::Value> = result
            .conflict_details
            .iter()
            .map(|c| serde_json::json!({ "kind": c.kind, "row_id": c.row_id, "reason": c.reason }))
            .collect();
        let _ = app.emit("weavine:sync-conflicts", payload);
    }

    tauri::async_runtime::spawn_blocking(|| {
        let conn = open_db().map_err(|e| e.to_string())?;
        Ok(cloud_status_inner(&conn))
    })
    .await
    .map_err(|e| format!("status thread panicked: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cloud_logout() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = open_db().map_err(|e| e.to_string())?;
        sync::unlink(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("logout thread panicked: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cloud_sync_now() -> Result<sync::SyncResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut conn = open_db().map_err(|e| e.to_string())?;
        let rt = new_current_thread_runtime().map_err(|e| e.to_string())?;
        rt.block_on(sync::sync_once(&mut conn))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("sync thread panicked: {e}"))?
}

/// Clear the push watermark so the next sync re-pushes every local row.
///
/// One-off repair for rows stranded by a rejected entity kind: push only
/// selects `updated_at > watermark`, so rows the server refused (e.g. `note`
/// before the server's push whitelist knew the kind) had already been passed
/// by the watermark and would never be retried. Resetting it makes the next
/// `cloud_sync_now` re-push everything — the upserts are idempotent, so
/// already-synced data is simply rewritten unchanged.
#[tauri::command(rename_all = "snake_case")]
pub async fn cloud_sync_repair_repush() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = open_db().map_err(|e| e.to_string())?;
        sync::config::set(&conn, sync::config::KEY_LAST_PUSHED_AT, "").map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("sync thread panicked: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub fn cloud_status(db: State<'_, Database>) -> Result<CloudStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(cloud_status_inner(&conn))
}

fn new_current_thread_runtime() -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = crate::db::get_db_path();
    let conn = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn cloud_status_inner(conn: &rusqlite::Connection) -> CloudStatus {
    CloudStatus {
        linked: sync::is_linked(conn).unwrap_or(false),
        server_url: sync::config::get(conn, sync::config::KEY_SERVER_URL)
            .ok()
            .flatten(),
        user_email: sync::config::get(conn, sync::config::KEY_USER_EMAIL)
            .ok()
            .flatten(),
        last_pulled_revision: sync::config::last_pulled_revision(conn).unwrap_or(0),
        last_pushed_revision: sync::config::last_pushed_revision(conn).unwrap_or(0),
    }
}