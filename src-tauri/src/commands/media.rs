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

pub(crate) fn data_dir() -> Result<PathBuf, String> {
    let base = media_base_dir();
    fs::create_dir_all(&base).map_err(|e| format!("create {}: {e}", base.display()))?;
    Ok(base)
}

// Mirrors db::get_db_path() so the files:// protocol handler and upload
// resolve to the same directory tree.
fn media_base_dir() -> PathBuf {
    if let Some(base) = crate::install_id::app_data_dir() {
        return base;
    }
    #[cfg(target_os = "android")]
    {
        PathBuf::from("/data/user/0").join(crate::android_data_dir_name())
    }
    #[cfg(not(target_os = "android"))]
    {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(crate::android_data_dir_name())
    }
}

fn legacy_base_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Weavine")
        .join("avatars")
}

// One-shot migration for the v1.0.x → v1.0.14 path rename. Idempotent.
pub(crate) fn migrate_legacy_avatars() {
    let legacy = legacy_base_dir();
    let new = match data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    if !legacy.exists() {
        return;
    }
    copy_dir_recursive(&legacy, &new);
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) {
    let entries = match fs::read_dir(src) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let src_path = entry.path();
        let file_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let dst_path = dst.join(&file_name);
        if src_path.is_dir() {
            let _ = fs::create_dir_all(&dst_path);
            copy_dir_recursive(&src_path, &dst_path);
        } else if !dst_path.exists() {
            if let Some(parent) = dst_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(&src_path, &dst_path);
        }
    }
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

pub(crate) fn mime_from_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
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
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
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

#[tauri::command(rename_all = "snake_case")]
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
    // Mirror the server-side sync_contact_avatar trigger: the avatar Media
    // row must be reflected on Contact so the contact list/detail render
    // the image (avatarUrlFor reads contact.avatar_storage_key).
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    conn.execute(
        "UPDATE \"Contact\" SET avatar_storage_key=?1, avatar_mime=?2, updated_at=?3 \
         WHERE id=?4",
        params![&storage_key, &mime, &now, &contact_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(AvatarResult {
        media,
        data_url: data_url,
    })
}

#[tauri::command(rename_all = "snake_case")]
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
    // The Media.filename column stores the full storage_key (see upsert_media).
    let path = data_dir()?.join(&filename);
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

#[tauri::command(rename_all = "snake_case")]
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
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    conn.execute(
        "UPDATE \"Media\" SET deleted_at = ?1 WHERE user_id=?2 \
         AND kind='avatar' AND owner_type='contact' AND owner_id=?3",
        params![&now, &user_id, &contact_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE \"Contact\" SET avatar_storage_key=NULL, avatar_mime=NULL, updated_at=?1 \
         WHERE id=?2",
        params![&now, &contact_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
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
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    conn.execute(
        "UPDATE \"Media\" SET deleted_at = ?1 WHERE id=?2",
        params![&now, &media_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    static SEQ: AtomicUsize = AtomicUsize::new(0);
    // XDG_DATA_HOME is process-global, so concurrent tests would race on
    // `std::env::set_var`. Gate every set/reset through this lock.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn sandbox_root() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        std::env::temp_dir().join(format!("weavine-media-test-{pid}-{n}"))
    }

    fn with_xdg<F: FnOnce()>(sandbox: &PathBuf, f: F) {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = std::env::var_os("XDG_DATA_HOME");
        std::env::set_var("XDG_DATA_HOME", sandbox);
        f();
        match prev {
            Some(v) => std::env::set_var("XDG_DATA_HOME", v),
            None => std::env::remove_var("XDG_DATA_HOME"),
        }
        let _ = std::fs::remove_dir_all(sandbox);
    }

    #[test]
    fn data_dir_resolves_to_com_weavine_desktop_and_is_writable() {
        let sandbox = sandbox_root();
        with_xdg(&sandbox, || {
            let dir = data_dir().expect("data_dir should succeed");
            eprintln!("TEST debug: data_dir={:?}, sandbox={:?}", dir, sandbox);
            assert!(dir.is_dir(), "data_dir must create the directory");
            assert!(
                dir.starts_with(&sandbox),
                "data_dir should be under sandbox ({:?}), got: {:?}",
                sandbox,
                dir
            );
            assert!(
                dir.ends_with("com.weavine.desktop"),
                "data_dir should live under com.weavine.desktop, got: {}",
                dir.display()
            );
            assert!(
                !dir.to_string_lossy().contains("Weavine"),
                "data_dir must NOT carry the legacy Weavine/avatars suffix"
            );
            let probe = dir.join("probe.txt");
            std::fs::write(&probe, b"ok").expect("data_dir must be writable");
            assert_eq!(std::fs::read(&probe).unwrap(), b"ok");
        });
    }

    #[test]
    fn migrate_legacy_avatars_copies_files_idempotently() {
        let sandbox = sandbox_root();
        with_xdg(&sandbox, || {
            let legacy = sandbox.join("Weavine").join("avatars");
            let legacy_user = legacy.join("user_abc").join("avatar").join("contact").join("c1");
            std::fs::create_dir_all(&legacy_user).unwrap();
            std::fs::write(legacy_user.join("u1.webp"), b"binary-bytes-1").unwrap();
            std::fs::write(legacy_user.join("u2.webp"), b"binary-bytes-2").unwrap();

            migrate_legacy_avatars();

            let new = data_dir().unwrap();
            let new_user = new.join("user_abc").join("avatar").join("contact").join("c1");
            assert!(new_user.join("u1.webp").exists(), "u1 must be copied");
            assert!(new_user.join("u2.webp").exists(), "u2 must be copied");
            assert_eq!(
                std::fs::read(new_user.join("u1.webp")).unwrap(),
                b"binary-bytes-1"
            );

            std::fs::write(legacy_user.join("u3.webp"), b"binary-bytes-3").unwrap();
            migrate_legacy_avatars();
            assert!(
                new_user.join("u3.webp").exists(),
                "u3 must be copied on second call"
            );
            std::fs::write(legacy_user.join("u1.webp"), b"DIFFERENT").unwrap();
            migrate_legacy_avatars();
            assert_eq!(
                std::fs::read(new_user.join("u1.webp")).unwrap(),
                b"binary-bytes-1",
                "existing new file must NOT be overwritten"
            );
        });
    }

    #[test]
    fn upload_and_protocol_paths_agree() {
        let sandbox = sandbox_root();
        with_xdg(&sandbox, || {
            let (_path, storage_key) =
                write_avatar_file("user_abc", "c_xyz", "webp", b"round-trip").unwrap();
            let base = data_dir().unwrap();
            let resolved = base.join(&storage_key);
            assert!(resolved.exists(), "upload path must exist on disk");
            assert_eq!(std::fs::read(&resolved).unwrap(), b"round-trip");

            let protocol_url_path = format!("/files/{storage_key}");
            let key_from_url = protocol_url_path.trim_start_matches("/files/");
            let resolved_from_url = base.join(key_from_url);
            assert_eq!(
                resolved, resolved_from_url,
                "upload path and protocol URL must resolve identically"
            );
        });
    }
}