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
