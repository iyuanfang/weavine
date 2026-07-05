//! Tauri commands for cloud sync — login, logout, status, manual sync.
//!
//! Async commands run blocking sync work via `spawn_blocking` so the future
//! stays Send — rusqlite::Connection is !Send, can't be held across `.await`.

use serde::Serialize;
use tauri::State;

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
    server_url: String,
    email: String,
    password: String,
) -> Result<CloudStatus, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db().map_err(|e| e.to_string())?;
        let rt = new_current_thread_runtime().map_err(|e| e.to_string())?;
        rt.block_on(sync::link(&conn, &server_url, &email, &password))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("sync thread panicked: {e}"))??;

    eprintln!(
        "[sync] initial sync done: pushed={} pulled={} conflicts={}",
        result.pushed, result.pulled, result.conflicts
    );

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
        let conn = open_db().map_err(|e| e.to_string())?;
        let rt = new_current_thread_runtime().map_err(|e| e.to_string())?;
        rt.block_on(sync::sync_once(&conn))
            .map_err(|e| e.to_string())
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