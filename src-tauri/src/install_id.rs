//! Stable per-install UUID used for activation tracking.
//!
//! On first launch, mints a UUID v4 and persists it to a sidecar file
//! (`<data_dir>/install_id`). Subsequent calls return the same UUID
//! unless the user wipes the app data dir, which counts as a fresh install.
//!
//! The same UUID is sent as `X-Install-Id` on every cloud request and
//! becomes the `device_id` in the server's `devices` table once the user
//! logs in.

use std::fs;
use std::path::PathBuf;

#[cfg(not(target_os = "android"))]
fn install_id_path() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("com.weavine.desktop");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("install_id"))
}

#[cfg(target_os = "android")]
fn install_id_path() -> Option<PathBuf> {
    // Android uses $HOME/com.weavine.desktop/files/ (set by the Tauri
    // runtime). We don't pull `dirs` here to avoid path layout surprises.
    let dir = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("com.weavine.desktop").join("files"))?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("install_id"))
}

fn read_existing() -> Option<String> {
    let path = install_id_path()?;
    let body = fs::read_to_string(&path).ok()?;
    let trimmed = body.trim().to_string();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some(trimmed)
}

fn write_new() -> Option<String> {
    let path = install_id_path()?;
    let id = uuid::Uuid::new_v4().to_string();
    if fs::write(&path, &id).is_err() {
        return None;
    }
    Some(id)
}

pub fn get_or_create() -> String {
    if let Some(id) = read_existing() {
        return id;
    }
    write_new().unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

#[cfg(not(target_os = "android"))]
fn device_key_path() -> Option<PathBuf> {
    let dir = dirs::data_dir()?.join("com.weavine.desktop");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("device_key"))
}

#[cfg(target_os = "android")]
fn device_key_path() -> Option<PathBuf> {
    let dir = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("com.weavine.desktop").join("files"))?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("device_key"))
}

fn read_existing_device_key() -> Option<String> {
    let path = device_key_path()?;
    let body = fs::read_to_string(&path).ok()?;
    let trimmed = body.trim().to_string();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return None;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some(trimmed)
}

fn write_device_key(key: &str) {
    if let Some(path) = device_key_path() {
        let _ = fs::write(&path, key);
    }
}

pub fn get_or_create_device_key() -> Option<String> {
    if let Some(k) = read_existing_device_key() {
        return Some(k);
    }
    let k = uuid::Uuid::new_v4().simple().to_string();
    write_device_key(&k);
    Some(k)
}

/// Synchronous anonymous activation: returns the cached server-minted
/// `device_key` if available, otherwise hits `POST /api/activation/ping`
/// and persists the server-issued key. Use this from cloud paths that
/// must work on a brand-new install before the 5 s first-launch ping has
/// completed — without it the server rejects anonymous calls (no
/// `X-Device-Key` matches yet in `install_activation.device_key`).
///
/// Best-effort: on any failure (network, timeout, parse), returns
/// `Option::None` and the caller should surface the underlying cloud
/// error to the user.
pub async fn ensure_device_key_registered(server_url: &str) -> Option<String> {
    if let Some(k) = read_existing_device_key() {
        return Some(k);
    }
    let install_id = get_or_create();
    let url = format!("{}/api/activation/ping", server_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "install_id": install_id,
        "app_version": env!("CARGO_PKG_VERSION"),
        "os": os_str(),
        "platform": platform_str(),
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    let text = resp.text().await.ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let k = v.get("device_key").and_then(|x| x.as_str())?;
    save_device_key(k);
    Some(k.to_string())
}

pub fn save_device_key(key: &str) {
    if key.is_empty() || key.len() > 64 {
        return;
    }
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return;
    }
    write_device_key(key);
}

pub fn platform_str() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else {
        "desktop"
    }
}

pub fn os_str() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else {
        std::env::consts::OS
    }
}
/// Fires a single `POST /api/activation/ping` 5 seconds after `setup()` to
/// register this install in the server's `install_activation` table, even
/// if the user never uses a cloud feature. Uses the effective server URL
/// (stored value, or the built-in default for fresh installs) so anonymous
/// OCR / voice callers can still obtain a `device_key` before login.
/// Best-effort: any failure is logged and ignored. The response carries the
/// device_key, which is persisted to `<data_dir>/device_key` for subsequent
/// cloud calls.
#[cfg(feature = "tauri")]
pub fn spawn_first_launch_ping(app: tauri::AppHandle) {
    use tauri::Manager;
    let server_url = {
        let db = match app.try_state::<crate::db::Database>() {
            Some(db) => db,
            None => return,
        };
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        crate::sync::config::effective_server_url(&conn)
    };
    let url = format!("{}/api/activation/ping", server_url.trim_end_matches('/'));
    let install_id = get_or_create();
    let body = serde_json::json!({
        "install_id": install_id,
        "app_version": env!("CARGO_PKG_VERSION"),
        "os": os_str(),
        "platform": platform_str(),
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let resp = reqwest::Client::new()
            .post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;
        if let Ok(r) = resp {
            if let Ok(text) = r.text().await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(k) = v.get("device_key").and_then(|x| x.as_str()) {
                        save_device_key(k);
                    }
                }
            }
        }
    });
}
