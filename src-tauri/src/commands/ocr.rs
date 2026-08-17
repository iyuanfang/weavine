use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::Database;
use crate::sync::config;

fn strip_data_url_prefix(s: &str) -> &str {
    match s.find(',') {
        Some(i) => s[i + 1..].trim_start(),
        None => s,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrFields {
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub email: Option<String>,
    pub phone: Vec<String>,
    pub address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrLine { pub text: String }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrResult {
    pub raw_text: String,
    pub lines: Vec<OcrLine>,
    pub fields: OcrFields,
    pub avg_confidence: f32,
    pub langs: String,
    pub langs_actual: Vec<String>,
}

fn load_credentials(conn: &rusqlite::Connection) -> Result<(String, String), String> {
    let url = config::get(conn, config::KEY_SERVER_URL)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "未连接云端".to_string())?;
    let token = config::get(conn, config::KEY_ACCESS_TOKEN)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "未登录云端".to_string())?;
    Ok((url, token))
}

fn load_service_key(conn: &rusqlite::Connection) -> String {
    config::get(conn, config::KEY_SERVICE_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .or_else(|| option_env!("WV_SERVICE_KEY").map(str::to_string))
        .unwrap_or_default()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn extract_card(
    db: State<'_, Database>,
    image_base64: String,
) -> Result<OcrResult, String> {
    let (server_url, user_token, service_key) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let url = config::effective_server_url(&conn);
        let user_token = config::get(&conn, config::KEY_ACCESS_TOKEN)
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());
        let service_key = load_service_key(&conn);
        (url, user_token, service_key)
    };

    let url = format!("{}/api/cards/extract", server_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new().post(&url);
    if let Some(tok) = user_token {
        req = req.bearer_auth(tok);
    } else if !service_key.is_empty() {
        req = req
            .header("X-Service-Key", &service_key)
            .bearer_auth(&service_key);
    } else {
        let k = crate::install_id::ensure_device_key_registered(&server_url)
            .await
            .ok_or_else(|| "未登录云端".to_string())?;
        req = req.header("X-Device-Key", k);
    }

    let install_id = crate::install_id::get_or_create();
    let platform = crate::install_id::platform_str();
    let os = crate::install_id::os_str();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let req = req
        .header("X-Install-Id", &install_id)
        .header("X-Client-Platform", platform)
        .header("X-Client-OS", os)
        .header("X-App-Version", app_version);

    let bytes = B64.decode(strip_data_url_prefix(&image_base64).as_bytes())
        .map_err(|e| format!("decode base64: {e}"))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("card.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("kind", "card_image")
        .part("file", part);

    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("ocr request failed: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("ocr failed ({}): {}", status, body));
    }

    serde_json::from_str::<OcrResult>(&body).map_err(|e| format!("parse ocr response: {e}"))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_card_image(
    db: State<'_, Database>,
    contact_id: String,
    image_base64: String,
) -> Result<serde_json::Value, String> {
    let (server_url, user_token, service_key) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let url = config::effective_server_url(&conn);
        let user_token = config::get(&conn, config::KEY_ACCESS_TOKEN)
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty());
        let service_key = load_service_key(&conn);
        (url, user_token, service_key)
    };

    let url = format!("{}/api/media", server_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new().post(&url);
    if let Some(tok) = user_token {
        req = req.bearer_auth(tok);
    } else if !service_key.is_empty() {
        req = req
            .header("X-Service-Key", &service_key)
            .bearer_auth(&service_key);
    } else {
        let k = crate::install_id::ensure_device_key_registered(&server_url)
            .await
            .ok_or_else(|| "未登录云端".to_string())?;
        req = req.header("X-Device-Key", k);
    }

    let install_id = crate::install_id::get_or_create();
    let platform = crate::install_id::platform_str();
    let os = crate::install_id::os_str();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let req = req
        .header("X-Install-Id", &install_id)
        .header("X-Client-Platform", platform)
        .header("X-Client-OS", os)
        .header("X-App-Version", app_version);

    let bytes = B64.decode(strip_data_url_prefix(&image_base64).as_bytes())
        .map_err(|e| format!("decode base64: {e}"))?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("card.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("kind", "card_image")
        .text("owner_type", "contact")
        .text("owner_id", contact_id)
        .part("file", part);

    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("upload request failed: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("upload failed ({}): {}", status, body));
    }

    serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|e| format!("parse upload response: {e}"))
}