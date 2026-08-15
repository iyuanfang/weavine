//! Activation tracking: anonymous usage stats driven by `X-Install-Id`.
//!
//! The client mints a UUID v4 on first launch and writes it to a sidecar
//! file (`<data_dir>/install_id`). It then sends it on every cloud call
//! (`X-Install-Id`) plus optional platform metadata. The server upserts
//! one row per unique install.
//!
//! Two entry points:
//! 1. `POST /api/activation/ping` — explicit first-launch ping from the
//!    client (Tauri 5s after startup, web on first page load). Always
//!    fires, regardless of whether the user ever uses OCR/voice.
//! 2. `record_activation_hook(...)` — implicit, fired from the
//!    service-key handler in `handlers/voice.rs` and `handlers/ocr.rs`
//!    after every successful auth. Refreshes `last_seen_at` and bumps
//!    `call_count`.
//!
//! The same UUID becomes the `device_id` in `devices` once the user logs
//! in, so multi-device users can be detected by joining on `user_id`.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::env;
use std::fmt::Write;
use std::sync::Arc;

const MAX_INSTALL_ID_LEN: usize = 64;
const MAX_VERSION_LEN: usize = 32;
const MAX_OS_LEN: usize = 32;
const MAX_PLATFORM_LEN: usize = 16;
const MAX_EVENT_LEN: usize = 16;

#[derive(Debug, Deserialize, Serialize)]
pub struct ActivationPing {
    pub install_id: String,
    pub app_version: String,
    pub os: String,
    pub platform: String,
}

#[derive(Debug, Serialize)]
pub struct ActivationPingResp {
    pub ok: bool,
    pub first_seen_at: String,
    pub call_count: i64,
}

#[derive(Debug, Serialize)]
pub struct ActivationError {
    pub error: String,
}

fn validate_field(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{name} is required"));
    }
    if value.len() > max {
        return Err(format!("{name} too long (max {max})"));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+' | ' '))
    {
        return Err(format!("{name} contains invalid characters"));
    }
    Ok(())
}

fn ip_hash_for(ip: &str) -> String {
    let salt = env::var("JWT_SECRET").unwrap_or_else(|_| "weavine-default".to_string());
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b"|");
    hasher.update(ip.as_bytes());
    let bytes = hasher.finalize();
    let mut hex = String::with_capacity(32);
    for b in &bytes[..16] {
        let _ = write!(hex, "{b:02x}");
    }
    hex
}

fn client_ip(headers: &HeaderMap, fallback: &str) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(real) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = real.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    fallback.to_string()
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub async fn ping(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<ActivationPing>,
) -> Result<Json<ActivationPingResp>, (StatusCode, Json<ActivationError>)> {
    if let Err(e) = validate_field("install_id", &body.install_id, MAX_INSTALL_ID_LEN) {
        return Err((StatusCode::BAD_REQUEST, Json(ActivationError { error: e })));
    }
    if let Err(e) = validate_field("app_version", &body.app_version, MAX_VERSION_LEN) {
        return Err((StatusCode::BAD_REQUEST, Json(ActivationError { error: e })));
    }
    if let Err(e) = validate_field("os", &body.os, MAX_OS_LEN) {
        return Err((StatusCode::BAD_REQUEST, Json(ActivationError { error: e })));
    }
    if let Err(e) = validate_field("platform", &body.platform, MAX_PLATFORM_LEN) {
        return Err((StatusCode::BAD_REQUEST, Json(ActivationError { error: e })));
    }
    if !matches!(body.platform.as_str(), "desktop" | "android" | "web") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ActivationError {
                error: "platform must be desktop|android|web".into(),
            }),
        ));
    }

    let ip = client_ip(&headers, "0.0.0.0");
    let ip_hash = ip_hash_for(&ip);
    let now = now_rfc3339();

    let row: (String, i64) = sqlx::query_as(
        r#"
        INSERT INTO install_activation
            (install_id, first_seen_at, last_seen_at, app_version, os, platform,
             last_ip_hash, call_count, last_event)
        VALUES ($1, $2, $2, $3, $4, $5, $6, 1, 'launch')
        ON CONFLICT (install_id) DO UPDATE SET
            last_seen_at = EXCLUDED.last_seen_at,
            call_count = install_activation.call_count + 1,
            last_event = 'launch',
            last_ip_hash = EXCLUDED.last_ip_hash
        RETURNING
            COALESCE(install_activation.first_seen_at, EXCLUDED.last_seen_at),
            install_activation.call_count
        "#,
    )
    .bind(&body.install_id)
    .bind(&now)
    .bind(&body.app_version)
    .bind(&body.os)
    .bind(&body.platform)
    .bind(&ip_hash)
    .fetch_one(pool.as_ref())
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ActivationError {
                error: format!("activation upsert failed: {e}"),
            }),
        )
    })?;

    Ok(Json(ActivationPingResp {
        ok: true,
        first_seen_at: row.0,
        call_count: row.1,
    }))
}

/// Fires after a successful service-key auth on OCR/voice. Looks at the
/// `X-Install-Id` / `X-Client-*` headers and upserts one row. Best-effort:
/// never returns an error to the caller — if activation fails, the OCR/voice
/// response should still go out.
pub async fn record_activation_hook(
    headers: &HeaderMap,
    pool: &PgPool,
    event: &str,
) {
    let install_id = match headers.get("x-install-id").and_then(|v| v.to_str().ok()) {
        Some(s) if !s.is_empty() && s.len() <= MAX_INSTALL_ID_LEN => s.to_string(),
        _ => return,
    };
    let app_version = headers
        .get("x-app-version")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let os = headers
        .get("x-client-os")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    let platform = headers
        .get("x-client-platform")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("desktop")
        .to_string();
    let event = if event.is_empty() || event.len() > MAX_EVENT_LEN {
        "voice"
    } else {
        event
    };

    let ip = client_ip(headers, "0.0.0.0");
    let ip_hash = ip_hash_for(&ip);
    let now = now_rfc3339();

    let _ = sqlx::query(
        r#"
        INSERT INTO install_activation
            (install_id, first_seen_at, last_seen_at, app_version, os, platform,
             last_ip_hash, call_count, last_event)
        VALUES ($1, $2, $2, $3, $4, $5, $6, 1, $7)
        ON CONFLICT (install_id) DO UPDATE SET
            last_seen_at = EXCLUDED.last_seen_at,
            call_count = install_activation.call_count + 1,
            last_event = EXCLUDED.last_event,
            last_ip_hash = EXCLUDED.last_ip_hash
        "#,
    )
    .bind(&install_id)
    .bind(&now)
    .bind(&app_version)
    .bind(&os)
    .bind(&platform)
    .bind(&ip_hash)
    .bind(event)
    .execute(pool)
    .await;
}

