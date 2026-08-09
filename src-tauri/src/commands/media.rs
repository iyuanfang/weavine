use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use crate::db::Database;
use crate::models::Media;

const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct AvatarResult {
    pub media: Media,
    pub data_url: String,
}

fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir().ok_or_else(|| "no data dir".to_string())?;
    let p = dir.join("Weavine").join("avatars");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

fn row_to_media(r: &rusqlite::Row) -> rusqlite::Result<Media> {
    Ok(Media {
        id: r.get(0)?,
        user_id: r.get(1)?,
        kind: r.get(2)?,
        owner_type: r.get(3)?,
        owner_id: r.get(4)?,
        mime: r.get(5)?,
        size_bytes: r.get(6)?,
        sha256: r.get(7).ok(),
        filename: r.get(8).ok(),
        storage_key: r.get(9)?,
        width: r.get(10).ok(),
        height: r.get(11).ok(),
        alt_text: r.get(12).ok(),
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn ext_from_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}

fn decode_data_url(url: &str) -> Result<(Vec<u8>, String), String> {
    let url = url.trim();
    if !url.starts_with("data:") {
        return Err("expected data URL".into());
    }
    let comma = url.find(',').ok_or("malformed data URL")?;
    let meta = &url[5..comma];
    let body = &url[comma + 1..];
    let mime = meta
        .split(';')
        .next()
        .ok_or("malformed data URL")?
        .to_string();
    let bytes = if meta.contains(";base64") {
        B64.decode(body).map_err(|e| e.to_string())?
    } else {
        urldecode(body).into_bytes()
    };
    Ok((bytes, mime))
}

fn urldecode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00"),
                16,
            ) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn sha256_hex(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    format!("{:x}", h.finalize())
}

fn write_avatar_file(
    user_id: &str,
    contact_id: &str,
    ext: &str,
    bytes: &[u8],
) -> Result<(PathBuf, String), String> {
    let dir = data_dir()?.join(user_id).join("avatar").join("contact").join(contact_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let filename = format!("{uuid}.{ext}");
    let path = dir.join(&filename);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let storage_key = format!("{user_id}/avatar/contact/{contact_id}/{filename}");
    Ok((path, storage_key))
}

fn upsert_media(
    conn: &Connection,
    user_id: &str,
    owner_id: &str,
    mime: &str,
    size: i64,
    sha: &str,
    filename: Option<&str>,
    storage_key: &str,
) -> Result<Media, String> {
    let existing: Option<(String,)> = conn
        .query_row(
            "SELECT id FROM \"Media\" WHERE user_id=?1 AND kind='avatar' \
             AND owner_type='contact' AND owner_id=?2",
            params![user_id, owner_id],
            |r| Ok((r.get(0)?,)),
        )
        .ok();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    if let Some((id,)) = existing {
        conn.execute(
            "UPDATE \"Media\" SET mime=?1, size_bytes=?2, sha256=?3, filename=?4, storage_key=?5, updated_at=?6 \
             WHERE id=?7",
            params![mime, size, sha, filename, storage_key, &now, &id],
        )
        .map_err(|e| e.to_string())?;
        let row = conn.query_row(
            "SELECT id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, storage_key, width, height, alt_text, created_at, updated_at \
             FROM \"Media\" WHERE id=?1",
            params![&id],
            row_to_media,
        )
        .map_err(|e| e.to_string())?;
        Ok(row)
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO \"Media\" (id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, storage_key, created_at, updated_at) \
             VALUES (?1, ?2, 'avatar', 'contact', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![&id, user_id, owner_id, mime, size, sha, filename, storage_key, &now],
        )
        .map_err(|e| e.to_string())?;
        let row = conn.query_row(
            "SELECT id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, storage_key, width, height, alt_text, created_at, updated_at \
             FROM \"Media\" WHERE id=?1",
            params![&id],
            row_to_media,
        )
        .map_err(|e| e.to_string())?;
        Ok(row)
    }
}

#[tauri::command]
pub fn upload_avatar(
    db: tauri::State<Database>,
    user_id: String,
    contact_id: String,
    data_url: String,
) -> Result<AvatarResult, String> {
    let (bytes, mime) = decode_data_url(&data_url)?;
    if bytes.is_empty() {
        return Err("empty payload".into());
    }
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err(format!("avatar too large ({} > {})", bytes.len(), MAX_AVATAR_BYTES));
    }
    if !mime.starts_with("image/") {
        return Err(format!("unsupported mime: {mime}"));
    }
    let sha = sha256_hex(&bytes);
    let ext = ext_from_mime(&mime);
    let (_path, storage_key) = write_avatar_file(&user_id, &contact_id, ext, &bytes)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let media = upsert_media(
        &conn,
        &user_id,
        &contact_id,
        &mime,
        bytes.len() as i64,
        &sha,
        Some(&storage_key),
        &storage_key,
    )?;
    Ok(AvatarResult {
        media,
        data_url: data_url,
    })
}

#[tauri::command]
pub fn get_avatar(
    db: tauri::State<Database>,
    user_id: String,
    contact_id: String,
) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let row: Option<(String,)> = conn
        .query_row(
            "SELECT filename FROM \"Media\" WHERE user_id=?1 AND kind='avatar' \
             AND owner_type='contact' AND owner_id=?2",
            params![&user_id, &contact_id],
            |r| Ok((r.get(0)?,)),
        )
        .ok();
    let Some((filename,)) = row else { return Ok(None) };
    let path = data_dir()?.join(&user_id).join(&filename);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = match path.extension().and_then(|s| s.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    };
    Ok(Some(format!(
        "data:{};base64,{}",
        mime,
        B64.encode(&bytes)
    )))
}

#[tauri::command]
pub fn delete_avatar(
    db: tauri::State<Database>,
    user_id: String,
    contact_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let row: Option<(String,)> = conn
        .query_row(
            "SELECT storage_key FROM \"Media\" WHERE user_id=?1 AND kind='avatar' \
             AND owner_type='contact' AND owner_id=?2",
            params![&user_id, &contact_id],
            |r| Ok((r.get(0)?,)),
        )
        .ok();
    let Some((storage_key,)) = row else { return Ok(()) };
    let path = data_dir()?.join(&storage_key);
    let _ = fs::remove_file(&path);
    conn.execute(
        "UPDATE \"Media\" SET deleted_at = datetime('now') WHERE user_id=?1 \
         AND kind='avatar' AND owner_type='contact' AND owner_id=?2",
        params![&user_id, &contact_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_media_by_owner(
    db: tauri::State<Database>,
    user_id: String,
    kind: String,
    owner_type: String,
    owner_id: String,
) -> Result<Vec<Media>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, storage_key, width, height, alt_text, created_at, updated_at \
             FROM \"Media\" WHERE user_id=?1 AND kind=?2 AND owner_type=?3 AND owner_id=?4 \
             AND deleted_at IS NULL ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&user_id, &kind, &owner_type, &owner_id], row_to_media)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_media_data_url(
    db: tauri::State<Database>,
    media_id: String,
) -> Result<Option<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT storage_key, mime FROM \"Media\" \
             WHERE id=?1 AND deleted_at IS NULL",
            params![&media_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((storage_key, mime)) = row else { return Ok(None) };
    let path = data_dir()?.join(&storage_key);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(format!(
        "data:{};base64,{}",
        mime,
        B64.encode(&bytes)
    )))
}

#[tauri::command]
pub fn delete_media(
    db: tauri::State<Database>,
    media_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let row: Option<(String,)> = conn
        .query_row(
            "SELECT storage_key FROM \"Media\" \
             WHERE id=?1 AND deleted_at IS NULL",
            params![&media_id],
            |r| Ok((r.get(0)?,)),
        )
        .ok();
    let Some((storage_key,)) = row else { return Ok(()) };
    let path = data_dir()?.join(&storage_key);
    let _ = fs::remove_file(&path);
    conn.execute(
        "UPDATE \"Media\" SET deleted_at = datetime('now') WHERE id=?1",
        params![&media_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}