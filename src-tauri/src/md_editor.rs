//! §11.7 md file editor — Rust side.
//!
//! Commands exposed to web-spa:
//!   - read_md_file           : read .md from disk with encoding detect (UTF-8/BOM/GBK/GB18030)
//!   - write_md_file          : write .md as UTF-8 no BOM
//!   - open_md_dialog         : native file picker, returns selected path or null
//!   - save_md_dialog         : native save-as dialog, returns path or null
//!   - md_get_recent_files    : LRU 10 list of recent .md paths
//!   - md_clear_recent_files  : wipe the list
//!   - md_check_import_status : for re-import prompt — returns existing note + imported_at
//!   - md_import_to_library   : create or update Note from .md (mtime-based fast path)
//!   - md_export_note_as_md   : write Note body to .md and set file mtime = imported_at
//!
//! All file ops are pure (no DB writes except for the import/export paths).

use crate::db::Database;
use crate::sync::config as sync_config;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const RECENT_FILES_KEY: &str = "recent_files";
const RECENT_FILES_LIMIT: usize = 10;
const LIBRARY_IMPORT_MAX_BYTES: u64 = 1_048_576; // 1 MB

#[derive(Debug, Serialize)]
pub struct ReadResult {
    pub content: String,
    pub encoding: String,    // "utf-8", "utf-8-bom", "gbk", "gb18030", "unknown"
    pub size_bytes: u64,
    pub mtime_unix_ms: i64,
    pub bom_detected: bool,
    pub had_replacement_chars: bool, // when UTF-8 conversion hit U+FFFD
}

#[derive(Debug, Serialize)]
pub struct WriteResult {
    pub mtime_unix_ms: i64,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub last_opened_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ImportStatus {
    pub already_imported: bool,
    pub note_id: Option<String>,
    pub note_title: Option<String>,
    pub imported_at: Option<String>,
    pub file_mtime_unix_ms: i64,
    pub reimport_needed: bool, // true when file mtime > imported_at
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub action: String, // "fast-skip", "created", "updated", "imported-as-new"
    pub note_id: String,
    pub note: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct ImportInput {
    pub user_id: String,
    pub path: String,
    pub title: Option<String>,
    pub body: Option<String>, // if provided, skip re-read (used by export→reimport fast path)
    /// "create" | "update" | "as-new" — required when re-import prompt answered
    pub mode: Option<String>,
    pub existing_note_id: Option<String>,
}

// ── Encoding detect + read ──────────────────────────────────────────────

fn detect_and_decode(bytes: &[u8]) -> (String, String, bool, bool) {
    // BOM strip + UTF-8 fast path
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let stripped = &bytes[3..];
        match std::str::from_utf8(stripped) {
            Ok(s) => return (s.to_string(), "utf-8-bom".into(), true, false),
            Err(e) => {
                let (s, _, had_repl) = decode_lossy(stripped, "utf-8");
                return (s, "utf-8-bom".into(), true, had_repl);
            }
        }
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_string(), "utf-8".into(), false, false);
    }
    // chardetng for non-UTF8
    let detected = chardetng::EncodingDetector::new();
    let enc = detected.guess(Some(bytes), true);
    let name = format!("{:?}", enc).to_lowercase();
    let (s, _, had_repl) = decode_lossy(bytes, &name);
    // chardetng returns Gibberish / Utf8 / Gb18030 / ...
    let normalized = match name.as_str() {
        s if s.contains("gb18030") => "gb18030",
        s if s.contains("gb") => "gbk",
        s if s.contains("utf") => "utf-8",
        _ => "unknown",
    };
    (s, normalized.into(), false, had_repl)
}

fn decode_lossy(bytes: &[u8], label: &str) -> (String, &'static encoding_rs::Encoding, bool) {
    let enc = match label {
        "gbk" | "gb18030" => encoding_rs::GBK,
        "utf-8" | "utf-8-bom" => encoding_rs::UTF_8,
        _ => encoding_rs::UTF_8,
    };
    let (cow, enc_used, had_repl) = enc.decode(bytes);
    (cow.into_owned(), enc_used, had_repl)
}

fn file_mtime_unix_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn read_md_file(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    let mut f = fs::File::open(&p).map_err(|e| format!("打开失败: {e}"))?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes).map_err(|e| format!("读取失败: {e}"))?;
    let size = bytes.len() as u64;
    let (content, encoding, bom, had_repl) = detect_and_decode(&bytes);
    Ok(ReadResult {
        content,
        encoding,
        size_bytes: size,
        mtime_unix_ms: file_mtime_unix_ms(&p),
        bom_detected: bom,
        had_replacement_chars: had_repl,
    })
}

#[tauri::command]
pub fn write_md_file(path: String, content: String) -> Result<WriteResult, String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    // Validate UTF-8 round-trip (we own content as String — guaranteed valid)
    let mut f = fs::File::create(&p).map_err(|e| format!("创建文件失败: {e}"))?;
    f.write_all(content.as_bytes()).map_err(|e| format!("写入失败: {e}"))?;
    f.sync_all().ok();
    let size = content.as_bytes().len() as u64;
    let mtime = file_mtime_unix_ms(&p);
    Ok(WriteResult {
        mtime_unix_ms: mtime,
        size_bytes: size,
    })
}

#[tauri::command]
pub fn md_get_file_info(path: String) -> Result<ReadResult, String> {
    // Like read_md_file but returns empty content for large files; just metadata.
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    let meta = fs::metadata(&p).map_err(|e| format!("stat 失败: {e}"))?;
    Ok(ReadResult {
        content: String::new(),
        encoding: "unknown".into(),
        size_bytes: meta.len(),
        mtime_unix_ms: file_mtime_unix_ms(&p),
        bom_detected: false,
        had_replacement_chars: false,
    })
}

// ── Native dialogs ──────────────────────────────────────────────────────

#[tauri::command(rename_all = "snake_case")]
pub async fn open_md_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_title("打开 .md 文件")
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    let path = rx.await.map_err(|e| format!("dialog cancelled: {e}"))?;
    Ok(path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_md_dialog(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_title("保存为 .md");
    if let Some(name) = default_name {
        builder = builder.set_file_name(&name);
    }
    builder.save_file(move |path| {
        let _ = tx.send(path);
    });
    let path = rx.await.map_err(|e| format!("dialog cancelled: {e}"))?;
    Ok(path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

// ── Recent files (KV-backed LRU) ────────────────────────────────────────

fn load_recent(conn: &Connection) -> Vec<RecentFile> {
    let raw = match sync_config::get(conn, RECENT_FILES_KEY) {
        Ok(Some(s)) => s,
        _ => return Vec::new(),
    };
    let parsed: Result<Vec<RecentFile>, _> = serde_json::from_str(&raw);
    parsed.unwrap_or_default()
}

fn save_recent(conn: &Connection, list: &[RecentFile]) -> rusqlite::Result<()> {
    let json = serde_json::to_string(list).unwrap_or_else(|_| "[]".into());
    sync_config::set(conn, RECENT_FILES_KEY, &json)
}

#[tauri::command]
pub fn md_get_recent_files(db: State<Database>) -> Result<Vec<RecentFile>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(load_recent(&conn))
}

#[tauri::command]
pub fn md_add_recent_file(db: State<Database>, path: String) -> Result<Vec<RecentFile>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut list = load_recent(&conn);
    list.retain(|r| r.path != path);
    list.insert(0, RecentFile { path, last_opened_at: now });
    list.truncate(RECENT_FILES_LIMIT);
    save_recent(&conn, &list).map_err(|e| e.to_string())?;
    Ok(list)
}

#[tauri::command]
pub fn md_clear_recent_files(db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    sync_config::delete(&conn, RECENT_FILES_KEY).map_err(|e| e.to_string())
}

// ── Import / Export / Re-import mtime ───────────────────────────────────

fn find_note_by_imported_from(conn: &Connection, user_id: &str, path: &str) -> rusqlite::Result<Option<(String, String, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, imported_at FROM Note WHERE user_id = ?1 AND imported_from = ?2 LIMIT 1",
    )?;
    let mut rows = stmt.query(params![user_id, path])?;
    if let Some(row) = rows.next()? {
        Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn md_check_import_status(
    db: State<Database>,
    user_id: String,
    path: String,
) -> Result<ImportStatus, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let file_mtime = file_mtime_unix_ms(Path::new(&path));
    match find_note_by_imported_from(&conn, &user_id, &path).map_err(|e| e.to_string())? {
        None => Ok(ImportStatus {
            already_imported: false,
            note_id: None,
            note_title: None,
            imported_at: None,
            file_mtime_unix_ms: file_mtime,
            reimport_needed: false,
        }),
        Some((id, title, imported_at)) => {
            // Parse imported_at as ISO8601 → ms; if newer than file, no reimport needed
            let imported_ms = imported_at
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
            let reimport_needed = file_mtime > imported_ms;
            Ok(ImportStatus {
                already_imported: true,
                note_id: Some(id),
                note_title: Some(title),
                imported_at,
                file_mtime_unix_ms: file_mtime,
                reimport_needed,
            })
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

#[tauri::command]
pub fn md_import_to_library(
    db: State<Database>,
    input: ImportInput,
) -> Result<ImportResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Read body if not supplied
    let body = match &input.body {
        Some(b) => b.clone(),
        None => {
            let read = read_md_file(input.path.clone())?;
            read.content
        }
    };

    let title = input.title.clone().unwrap_or_else(|| {
        std::path::Path::new(&input.path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "未命名笔记".into())
    });

    // Size guard
    if body.as_bytes().len() as u64 > LIBRARY_IMPORT_MAX_BYTES {
        return Err(format!(
            "文件超过 1 MB，无法导入库（{} bytes）",
            body.as_bytes().len()
        ));
    }

    let existing = find_note_by_imported_from(&conn, &input.user_id, &input.path)
        .map_err(|e| e.to_string())?;

    let file_mtime = file_mtime_unix_ms(Path::new(&input.path));
    let now = now_iso();

    // Fast-skip if no reimport needed and no mode forced
    if let Some((ref id, _, ref imp_at)) = existing {
        let imp_ms = imp_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);
        if file_mtime <= imp_ms && input.mode.is_none() {
            let note_json = fetch_note_json(&conn, &input.user_id, id).map_err(|e| e.to_string())?;
            return Ok(ImportResult {
                action: "fast-skip".into(),
                note_id: id.clone(),
                note: note_json,
            });
        }
    }

    let mode = input.mode.as_deref().unwrap_or("create");

    match (existing, mode) {
        // No existing note → just create
        (None, _) => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO Note (id, user_id, title, body, imported_from, imported_at, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)",
                params![id, input.user_id, title, body, input.path, now],
            ).map_err(|e| e.to_string())?;
            let note_json = fetch_note_json(&conn, &input.user_id, &id).map_err(|e| e.to_string())?;
            Ok(ImportResult { action: "created".into(), note_id: id, note: note_json })
        }
        // Existing + update
        (Some((id, _title, _imp_at)), "update") => {
            conn.execute(
                "UPDATE Note SET body = ?1, imported_at = ?2, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
                params![body, now, id, input.user_id],
            ).map_err(|e| e.to_string())?;
            let note_json = fetch_note_json(&conn, &input.user_id, &id).map_err(|e| e.to_string())?;
            Ok(ImportResult { action: "updated".into(), note_id: id, note: note_json })
        }
        // Existing + as-new
        (Some((_old_id, _old_title, _old_imp_at)), "as-new") => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO Note (id, user_id, title, body, imported_from, imported_at, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)",
                params![id, input.user_id, title, body, input.path, now],
            ).map_err(|e| e.to_string())?;
            let note_json = fetch_note_json(&conn, &input.user_id, &id).map_err(|e| e.to_string())?;
            Ok(ImportResult { action: "imported-as-new".into(), note_id: id, note: note_json })
        }
        // Existing + skip
        (Some((id, _t, _ia)), "skip") => {
            let note_json = fetch_note_json(&conn, &input.user_id, &id).map_err(|e| e.to_string())?;
            Ok(ImportResult { action: "fast-skip".into(), note_id: id, note: note_json })
        }
        // Existing + default (mode not provided AND reimport_needed): ask via status, but
        // if called without mode anyway, default to "update" so no silent loss
        (Some((id, _t, _ia)), "create") => {
            conn.execute(
                "UPDATE Note SET body = ?1, imported_at = ?2, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
                params![body, now, id, input.user_id],
            ).map_err(|e| e.to_string())?;
            let note_json = fetch_note_json(&conn, &input.user_id, &id).map_err(|e| e.to_string())?;
            Ok(ImportResult { action: "updated".into(), note_id: id, note: note_json })
        }
        // Unknown mode
        (Some((id, _t, _ia)), other) => Err(format!("unknown import mode: {other}")),
    }
}

fn fetch_note_json(conn: &Connection, user_id: &str, id: &str) -> rusqlite::Result<serde_json::Value> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at, imported_from, imported_at \
         FROM Note WHERE id = ?1 AND user_id = ?2",
    )?;
    let mut rows = stmt.query(params![id, user_id])?;
    if let Some(row) = rows.next()? {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "user_id": row.get::<_, String>(1)?,
            "title": row.get::<_, String>(2)?,
            "body": row.get::<_, String>(3)?,
            "archived_at": row.get::<_, Option<String>>(4)?,
            "created_at": row.get::<_, String>(5)?,
            "updated_at": row.get::<_, String>(6)?,
            // Desktop-only — sync translate already drops these, but for the
            // single-instance in-process read we surface them so the JS UI can
            // detect re-import cases.
            "imported_from": row.get::<_, Option<String>>(7)?,
            "imported_at": row.get::<_, Option<String>>(8)?,
        }))
    } else {
        Err(rusqlite::Error::QueryReturnedNoRows)
    }
}

#[tauri::command]
pub fn md_export_note_as_md(
    db: State<Database>,
    user_id: String,
    note_id: String,
    path: String,
) -> Result<WriteResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // Fetch body
    let body: String = conn
        .query_row(
            "SELECT body FROM Note WHERE id = ?1 AND user_id = ?2",
            params![note_id, user_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("note not found: {e}"))?;
    let imported_at: Option<String> = conn
        .query_row(
            "SELECT imported_at FROM Note WHERE id = ?1 AND user_id = ?2",
            params![note_id, user_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    drop(conn);
    // Write file
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&p, body.as_bytes()).map_err(|e| format!("写入失败: {e}"))?;
    // Set file mtime = imported_at (if available) so re-import fast path triggers
    if let Some(imp_at) = imported_at {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&imp_at) {
            let sys = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(dt.timestamp() as u64);
            let _ = filetime_touch(&p, sys);
        }
    }
    let mtime = file_mtime_unix_ms(&p);
    Ok(WriteResult {
        mtime_unix_ms: mtime,
        size_bytes: body.as_bytes().len() as u64,
    })
}

#[cfg(unix)]
fn filetime_touch(path: &Path, t: SystemTime) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().write(true).open(path)?;
    f.set_modified(t)
}

#[cfg(windows)]
fn filetime_touch(path: &Path, t: SystemTime) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().write(true).open(path)?;
    f.set_modified(t)
}
