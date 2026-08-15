use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Deserialize;
use tauri::State;

use crate::db::Database;
use crate::sync::config;

/// Cloud AI service key for voice recognition. Prefers the runtime-stored
/// `KEY_SERVICE_KEY` (set via `set_service_key`), falling back to the key
/// embedded in the binary at build time via the `WV_SERVICE_KEY` env var.
fn load_service_key(conn: &rusqlite::Connection) -> String {
    config::get(conn, config::KEY_SERVICE_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("WV_SERVICE_KEY").map(str::to_string))
        .unwrap_or_default()
}

#[derive(Debug, Deserialize)]
struct VoiceResponse {
    text: String,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn recognize_voice(
    db: State<'_, Database>,
    audio_base64: String,
) -> Result<String, String> {
    let (server_url, service_key) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let url = config::get(&conn, config::KEY_SERVER_URL)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "未连接云端".to_string())?;
        (url, load_service_key(&conn))
    };

    let bytes = B64.decode(audio_base64.as_bytes())
        .map_err(|e| format!("decode base64: {e}"))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("audio.webm")
        .mime_str("audio/webm")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let url = format!("{}/api/voice/recognize", server_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new()
        .post(&url)
        .multipart(form);
    if !service_key.is_empty() {
        req = req
            .header("X-Service-Key", &service_key)
            .bearer_auth(&service_key);
    }
    req = req
        .header("X-Install-Id", crate::install_id::get_or_create())
        .header("X-Client-Platform", crate::install_id::platform_str())
        .header("X-Client-OS", crate::install_id::os_str())
        .header("X-App-Version", env!("CARGO_PKG_VERSION"));
    if let Some(k) = crate::install_id::get_or_create_device_key() {
        req = req.header("X-Device-Key", k);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("voice request failed: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("voice recognition failed ({}): {}", status, body));
    }

    let parsed: VoiceResponse =
        serde_json::from_str(&body).map_err(|e| format!("parse voice response: {e}"))?;
    Ok(parsed.text)
}
