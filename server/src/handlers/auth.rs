use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, Header, Validation};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};
use std::time::Duration as StdDuration;
use crate::email::{self, EmailMessage};
use crate::handlers::JWT_KEYS;
use crate::rate_limit::RateLimiter;

pub const ACCESS_TOKEN_TTL_SECS: u64 = 7 * 24 * 60 * 60;
pub const REFRESH_TOKEN_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LEN: usize = 8;
const RESET_TOKEN_TTL_SECS: i64 = 60 * 60;

static PASSWORD_RESET_RL: OnceLock<RateLimiter> = OnceLock::new();

pub fn init_password_reset_rate_limiter() {
    PASSWORD_RESET_RL
        .set(RateLimiter::new())
        .expect("PASSWORD_RESET_RL already initialised");
}

fn reset_rate_limit() -> &'static RateLimiter {
    PASSWORD_RESET_RL
        .get()
        .expect("PASSWORD_RESET_RL not initialised; call init_password_reset_rate_limiter() in main")
}

/// Shared zero-friction service key for the OCR/STT endpoints (feature
/// `ocr`/`stt`). Loaded from `WV_SERVICE_KEY` once at startup by
/// `init_service_key`; if unset, a random key is generated and logged.
pub static SERVICE_KEY: OnceLock<String> = OnceLock::new();

/// Synthetic user id returned for service-account requests. Not a real
/// `user_account` row — OCR/voice handlers only check auth, never write.
pub const SERVICE_USER_ID: &str = "service:weavine-default";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub device_id: String,
    pub exp: u64,
    pub iat: u64,
}

#[derive(Deserialize)]
pub struct DeviceInfo {
    pub name: String,
    pub os: String,
    pub app_version: String,
    /// UUID v4 minted by the client on first launch and stored under
    /// `<data_dir>/install_id`. The server uses this as the `device_id`
    /// PK in the `devices` table so the same install can be tracked
    /// across both anonymous cloud calls (install_activation) and
    /// logged-in device rows (devices). Optional for backward
    /// compatibility — when missing, the server falls back to a
    /// freshly generated UUID.
    #[serde(default)]
    pub install_id: Option<String>,
}

fn device_id_from(info: &DeviceInfo) -> String {
    info.install_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 64)
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

#[derive(Deserialize)]
pub struct RegisterReq {
    pub email: String,
    pub password: String,
    pub device: DeviceInfo,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
    pub device: DeviceInfo,
}

#[derive(Deserialize)]
pub struct RefreshBody {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct LogoutBody {
    pub refresh_token: String,
}

#[derive(Serialize)]
pub struct AuthSession {
    pub user_id: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub id: String,
    pub email: String,
    pub devices: Vec<DeviceResponse>,
}

#[derive(Serialize)]
pub struct DeviceResponse {
    pub id: String,
    pub name: String,
    pub os: String,
    pub app_version: String,
    pub last_seen_at: String,
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let mut parts = raw.splitn(2, ' ');
    let scheme = parts.next()?;
    let token = parts.next()?;
    if scheme.eq_ignore_ascii_case("Bearer") {
        Some(token.to_string())
    } else {
        None
    }
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time")
        .as_secs() as i64
}

fn blake_hash(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

async fn lookup_api_key(
    raw_key: &str,
    pool: &PgPool,
) -> Result<String, (StatusCode, String)> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT user_id, key_hash FROM api_key WHERE revoked_at IS NULL")
            .fetch_all(pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("api_key lookup: {e}"),
                )
            })?;
    for (user_id, hash) in rows {
        let matches = PasswordHash::new(&hash)
            .ok()
            .and_then(|ph| {
                Argon2::default()
                    .verify_password(raw_key.as_bytes(), &ph)
                    .ok()
            })
            .is_some();
        if matches {
            let _ = sqlx::query(
                "UPDATE api_key SET last_used_at = $1 WHERE user_id = $2 AND key_hash = $3",
            )
            .bind(crate::handlers::now_str())
            .bind(&user_id)
            .bind(&hash)
            .execute(pool)
            .await;
            return Ok(user_id);
        }
    }
    Err((
        StatusCode::UNAUTHORIZED,
        "API key 无效或已撤销".to_string(),
    ))
}

pub async fn extract_auth(
    headers: &HeaderMap,
    pool: &PgPool,
) -> Result<String, (StatusCode, String)> {
    if let Some(raw_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        return lookup_api_key(raw_key, pool).await;
    }
    let token =
        extract_bearer(headers).ok_or((StatusCode::UNAUTHORIZED, "未登录".to_string()))?;
    // Additive: `Authorization: Bearer wvk_*` was previously JWT-only. Treat
    // `wvk_` as API key (same path as `X-API-Key`) for read AND write tools.
    if token.starts_with("wvk_") {
        return lookup_api_key(&token, pool).await;
    }
    let claims = verify_access(&token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "token 无效或已过期".to_string()))?;
    Ok(claims.sub)
}

pub async fn extract_auth_with_device(
    headers: &HeaderMap,
    pool: &PgPool,
) -> Result<(String, String), (StatusCode, String)> {
    if let Some(raw_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let user_id = lookup_api_key(raw_key, pool).await?;
        // API keys are not device-bound; empty device_id makes the sync
        // attribution GUC fall back to user-level.
        return Ok((user_id, String::new()));
    }
    if let Some(token) = extract_bearer(headers) {
        if token.starts_with("wvk_") {
            let user_id = lookup_api_key(&token, pool).await?;
            return Ok((user_id, String::new()));
        }
        let claims = verify_access(&token)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "token 无效或已过期".to_string()))?;
        return Ok((claims.sub, claims.device_id));
    }
    Err((StatusCode::UNAUTHORIZED, "未登录".to_string()))
}

/// Load the shared service key from `WV_SERVICE_KEY`, or generate a random one
/// and log it once. Call once from `main` before serving requests.
pub fn init_service_key() {
    let key = match std::env::var("WV_SERVICE_KEY") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => {
            let generated: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(48)
                .map(char::from)
                .collect();
            eprintln!("[service-key] ==============================================");
            eprintln!("[service-key] WV_SERVICE_KEY not set; generated ephemeral key:");
            eprintln!("[service-key]   {generated}");
            eprintln!("[service-key] Set WV_SERVICE_KEY in the environment to make it stable.");
            eprintln!("[service-key] ==============================================");
            generated
        }
    };
    SERVICE_KEY.set(key).expect("SERVICE_KEY already initialized");
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Service-account auth for the zero-friction OCR/STT endpoints.
///
/// Accepts the shared service key via `X-Service-Key` or
/// `Authorization: Bearer <service-key>` and returns `SERVICE_USER_ID`
/// (a synthetic id — no DB lookup or write happens).
///
/// Returns:
/// - `Ok(Some(user_id))` — a valid service key was presented.
/// - `Ok(None)` — no service credential was presented; callers may fall back
///   to normal user auth (JWT / API key). A non-matching `Bearer` token is
///   treated this way too, since it may be a real user JWT.
/// - `Err(401)` — an `X-Service-Key` header was present but did not match.
pub fn extract_auth_with_service(headers: &HeaderMap) -> Result<Option<String>, (StatusCode, String)> {
    if let Some(raw) = headers.get("x-service-key").and_then(|v| v.to_str().ok()) {
        let expected = SERVICE_KEY
            .get()
            .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "service key not loaded".to_string()))?;
        if constant_time_eq(raw.as_bytes(), expected.as_bytes()) {
            return Ok(Some(SERVICE_USER_ID.to_string()));
        }
        return Err((StatusCode::UNAUTHORIZED, "service key 无效".to_string()));
    }
    if let Some(token) = extract_bearer(headers) {
        if let Some(expected) = SERVICE_KEY.get() {
            if constant_time_eq(token.as_bytes(), expected.as_bytes()) {
                return Ok(Some(SERVICE_USER_ID.to_string()));
            }
        }
    }
    Ok(None)
}

/// Auth for the OCR/STT handlers: shared service key first, then normal user
/// auth (JWT / API key).
pub async fn extract_auth_service_or_user(
    headers: &HeaderMap,
    pool: &PgPool,
) -> Result<String, (StatusCode, String)> {
    if let Some(uid) = extract_auth_with_service(headers)? {
        return Ok(uid);
    }
    extract_auth(headers, pool).await
}

#[derive(Debug, Clone)]
pub enum EndpointAuth {
    /// Anonymous via X-Device-Key. install_id is the row's PK.
    AnonymousDevice { install_id: String },
    /// Logged-in user via JWT or API key.
    User { user_id: String, device_id: String },
    /// Shared service key (dev / CI). Synthetic id, no DB lookup.
    ServiceKey,
}

const MAX_DEVICE_KEY_LEN: usize = 64;

/// Auth for OCR/voice endpoints. Order:
/// 1. `X-Device-Key` — anonymous per-install key, validated against
///    `install_activation.device_key`. Preferred for anonymous users.
/// 2. JWT / API key — logged-in user (unchanged from before).
/// 3. `X-Service-Key` / `Bearer <service-key>` — dev / CI override.
///
/// Returns `EndpointAuth` describing which path matched.
pub async fn extract_endpoint_auth(
    headers: &HeaderMap,
    pool: &PgPool,
) -> Result<EndpointAuth, (StatusCode, String)> {
    if let Some(k) = headers.get("x-device-key").and_then(|v| v.to_str().ok()) {
        if k.is_empty() || k.len() > MAX_DEVICE_KEY_LEN {
            return Err((StatusCode::UNAUTHORIZED, "invalid X-Device-Key".into()));
        }
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT install_id FROM install_activation
             WHERE device_key = $1 AND revoked_at IS NULL",
        )
        .bind(k)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("device_key lookup: {e}"),
            )
        })?;
        return match row {
            Some((install_id,)) => Ok(EndpointAuth::AnonymousDevice { install_id }),
            None => Err((
                StatusCode::UNAUTHORIZED,
                "X-Device-Key 无效或已吊销".into(),
            )),
        };
    }

    if let Some(uid) = extract_auth_with_service(headers)? {
        let _ = uid;
        return Ok(EndpointAuth::ServiceKey);
    }

    if let Some(raw_key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        let user_id = lookup_api_key(raw_key, pool).await?;
        return Ok(EndpointAuth::User {
            user_id,
            device_id: String::new(),
        });
    }
    if let Some(token) = extract_bearer(headers) {
        if token.starts_with("wvk_") {
            let user_id = lookup_api_key(&token, pool).await?;
            return Ok(EndpointAuth::User {
                user_id,
                device_id: String::new(),
            });
        }
        let claims = verify_access(&token)
            .map_err(|_| (StatusCode::UNAUTHORIZED, "token 无效或已过期".to_string()))?;
        return Ok(EndpointAuth::User {
            user_id: claims.sub,
            device_id: claims.device_id,
        });
    }

    Err((StatusCode::UNAUTHORIZED, "未登录".to_string()))
}

fn verify_access(token: &str) -> Result<Claims, (StatusCode, String)> {
    let keys = JWT_KEYS
        .get()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "JWT keys not loaded".to_string()))?;
    decode::<Claims>(token, &keys.decoding, &Validation::new(Algorithm::RS256))
        .map(|data| data.claims)
        .map_err(|e| (StatusCode::UNAUTHORIZED, format!("invalid token: {e}")))
}

fn issue_access_token(
    user_id: &str,
    email: &str,
    device_id: &str,
) -> Result<String, (StatusCode, String)> {
    let keys = JWT_KEYS
        .get()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "JWT keys not loaded".to_string()))?;
    let iat = now_epoch() as u64;
    let exp = iat + ACCESS_TOKEN_TTL_SECS;
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        device_id: device_id.to_string(),
        iat,
        exp,
    };
    encode(&Header::new(Algorithm::RS256), &claims, &keys.encoding)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("jwt encode: {e}")))
}

async fn issue_refresh_token(
    pool: &PgPool,
    user_id: &str,
    device_id: &str,
) -> Result<String, (StatusCode, String)> {
    let raw: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let token_hash = blake_hash(&raw);
    let id = uuid::Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + Duration::seconds(REFRESH_TOKEN_TTL_SECS as i64))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO refresh_token (id, user_id, device_id, token_hash, expires_at, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(&device_id)
    .bind(&token_hash)
    .bind(&expires_at)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert refresh: {e}")))?;
    Ok(raw)
}

pub async fn register(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<RegisterReq>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err((StatusCode::BAD_REQUEST, "邮箱格式不正确".into()));
    }
    if body.password.len() < MIN_PASSWORD_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("密码至少 {} 位", MIN_PASSWORD_LEN),
        ));
    }

    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM user_account WHERE email = $1")
        .bind(&email)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "该邮箱已注册".into()));
    }

    let user_id = uuid::Uuid::new_v4().to_string();
    let device_id = device_id_from(&body.device);
    let pwhash = hash(body.password.as_bytes(), DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash: {e}")))?;
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO user_account (id, email, password_hash, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&pwhash)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert user: {e}")))?;

    sqlx::query(
        "INSERT INTO devices (id, user_id, name, os, app_version, last_seen_at, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&device_id)
    .bind(&user_id)
    .bind(&body.device.name)
    .bind(&body.device.os)
    .bind(&body.device.app_version)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert device: {e}")))?;

    let raw: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let token_hash = blake_hash(&raw);
    let expires_at = (Utc::now() + Duration::seconds(REFRESH_TOKEN_TTL_SECS as i64))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let refresh_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO refresh_token (id, user_id, device_id, token_hash, expires_at, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&refresh_id)
    .bind(&user_id)
    .bind(&device_id)
    .bind(&token_hash)
    .bind(&expires_at)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert refresh: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let access = issue_access_token(&user_id.to_string(), &email, &device_id.to_string())?;
    Ok(Json(AuthSession {
        user_id: user_id.to_string(),
        email,
        access_token: access,
        refresh_token: raw,
        device_id: device_id.to_string(),
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

pub async fn login(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<LoginReq>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "邮箱和密码必填".into()));
    }

    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, password_hash FROM user_account WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, pwhash) = match row {
        Some(r) => r,
        None => return Err((StatusCode::UNAUTHORIZED, "邮箱或密码错误".into())),
    };

    let ok = verify(body.password.as_bytes(), &pwhash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("verify: {e}")))?;
    if !ok {
        return Err((StatusCode::UNAUTHORIZED, "邮箱或密码错误".into()));
    }

    let device_id = device_id_from(&body.device);
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

sqlx::query(
        "INSERT INTO devices (id, user_id, name, os, app_version, last_seen_at, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (user_id, name, os) DO NOTHING",
    )
    .bind(&device_id)
    .bind(&user_id)
    .bind(&body.device.name)
    .bind(&body.device.os)
    .bind(&body.device.app_version)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert device: {e}")))?;

    let device_id: String = sqlx::query_scalar(
        "SELECT id FROM devices WHERE user_id = $1 AND name = $2 AND os = $3"
    )
    .bind(&user_id)
    .bind(&body.device.name)
    .bind(&body.device.os)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("select device: {e}")))?;

    sqlx::query("UPDATE devices SET last_seen_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(&device_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("touch device: {e}")))?;

    let raw: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let token_hash = blake_hash(&raw);
    let expires_at = (Utc::now() + Duration::seconds(REFRESH_TOKEN_TTL_SECS as i64))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let refresh_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO refresh_token (id, user_id, device_id, token_hash, expires_at, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&refresh_id)
    .bind(&user_id)
    .bind(&device_id)
    .bind(&token_hash)
    .bind(&expires_at)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert refresh: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let access = issue_access_token(&user_id.to_string(), &email, &device_id.to_string())?;
    Ok(Json(AuthSession {
        user_id: user_id.to_string(),
        email,
        access_token: access,
        refresh_token: raw,
        device_id: device_id.to_string(),
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

pub async fn refresh(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<RefreshBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let token_hash = blake_hash(&body.refresh_token);
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let row: Option<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT rt.user_id, ua.email, rt.device_id, d.revoked_at \
         FROM refresh_token rt \
         JOIN user_account ua ON ua.id = rt.user_id \
         JOIN devices d ON d.id = rt.device_id \
         WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > $2",
    )
    .bind(&token_hash)
    .bind(&now)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, email, device_id, device_revoked) = match row {
        Some(r) => r,
        None => return Err((StatusCode::UNAUTHORIZED, "refresh token 无效或已过期".into())),
    };

    if device_revoked.is_some() {
        return Err((StatusCode::UNAUTHORIZED, "设备已被吊销".into()));
    }

    let access = issue_access_token(&user_id.to_string(), &email, &device_id.to_string())?;
    let refresh = issue_refresh_token(&pool, &user_id, &device_id).await?;
    Ok(Json(AuthSession {
        user_id: user_id.to_string(),
        email,
        access_token: access,
        refresh_token: refresh,
        device_id,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

pub async fn logout(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<LogoutBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token_hash = blake_hash(&body.refresh_token);
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let changed = sqlx::query(
        "UPDATE refresh_token SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
    )
    .bind(&token_hash)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .rows_affected();

    if changed == 0 {
        return Err((StatusCode::UNAUTHORIZED, "refresh token 不存在".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn me(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;

    let email: Option<String> =
        sqlx::query_scalar("SELECT email FROM user_account WHERE id = $1")
            .bind(&auth)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let email = email.ok_or((StatusCode::UNAUTHORIZED, "用户不存在".to_string()))?;

    let device_rows = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT id, name, os, app_version, last_seen_at \
         FROM devices WHERE user_id = $1 AND revoked_at IS NULL \
         ORDER BY last_seen_at DESC",
    )
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let devices = device_rows
        .into_iter()
        .map(|(id, name, os, app_version, last_seen_at)| DeviceResponse {
            id,
            name,
            os,
            app_version,
            last_seen_at,
        })
        .collect();

    Ok(Json(MeResponse {
        id: auth,
        email,
        devices,
    }))
}

// ── Password reset ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ForgotPasswordReq {
    pub email: String,
}

#[derive(Serialize)]
pub struct ForgotPasswordResp {
    pub ok: bool,
}

#[derive(Deserialize)]
pub struct ResetPasswordReq {
    pub token: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct ResetPasswordResp {
    pub ok: bool,
}

fn reset_url_base() -> String {
    std::env::var("WEAVINE_RESET_URL_BASE")
        .unwrap_or_else(|_| "http://localhost:5173/reset-password".to_string())
}

fn random_reset_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

fn client_ip(headers: &HeaderMap, fallback: Option<std::net::SocketAddr>) -> String {
    if let Some(v) = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return v;
    }
    if let Some(v) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        return v;
    }
    fallback
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

pub async fn forgot_password(
    State(pool): State<Arc<PgPool>>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ForgotPasswordReq>,
) -> Result<Json<ForgotPasswordResp>, (StatusCode, String)> {
    let email_raw = body.email.trim().to_lowercase();
    let ip = client_ip(&headers, Some(peer));
    let rl = reset_rate_limit();

    // Per-IP cap first so an attacker can't burn through arbitrary emails.
    if !rl.check(
        "forgot-password",
        "ip",
        &ip,
        20,
        StdDuration::from_secs(60 * 60),
    ) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "请求过于频繁，请稍后再试".into(),
        ));
    }

    // Lookup user (if any). Always return `ok: true` to avoid leaking
    // which emails are registered; cap additional delay so timing also
    // does not leak.
    let user: Option<(String, String)> = if email_raw.contains('@') && email_raw.len() <= 254 {
        sqlx::query_as("SELECT id, email FROM user_account WHERE email = $1")
            .bind(&email_raw)
            .fetch_optional(pool.as_ref())
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        None
    };

    if let Some((user_id, email)) = user {
        // Per-email cap — checked AFTER the existence query so a
        // yes-bouncer can't be probed by timing.
        if rl.check(
            "forgot-password",
            "email",
            &email,
            5,
            StdDuration::from_secs(60 * 60),
        ) {
            let raw = random_reset_token();
            let token_hash = blake_hash(&raw);
            let id = uuid::Uuid::new_v4().to_string();
            let now = Utc::now();
            // RFC 3339 / ISO 8601 with `Z` suffix — lexicographically
            // sortable regardless of timezone, so string comparison in
            // `reset_password` works correctly even though the column is
            // stored as text.
            let expires_at = (now + Duration::seconds(RESET_TOKEN_TTL_SECS))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string();
            let created_at = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
            if let Err(e) = sqlx::query(
                "INSERT INTO password_reset_token (id, user_id, token_hash, expires_at, created_at) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(&id)
            .bind(&user_id)
            .bind(&token_hash)
            .bind(&expires_at)
            .bind(&created_at)
            .execute(pool.as_ref())
            .await
            {
                eprintln!("[auth] forgot-password insert failed: {e}");
            } else {
                let link = format!("{}?token={}", reset_url_base(), raw);
                let subject = "重置 Weavine 密码";
                let body = format!(
                    "您好，\n\n您（或冒充您的人）请求重置 Weavine 账户的密码。\n\n\
                     请在 60 分钟内点击以下链接继续：\n\n  {link}\n\n\
                     如果不是您本人请求，请忽略此邮件。\n\n— Weavine"
                );
                let send_res = email::sender()
                    .send(EmailMessage::new(email, subject, body))
                    .await;
                if let Err(e) = send_res {
                    eprintln!("[auth] forgot-password send failed: {e}");
                }
            }
        }
    } else {
        // Also burn the email budget so an attacker can't probe presence
        // by inspecting the per-email rejection vs the silent nothing.
        let _ = rl.check(
            "forgot-password",
            "email",
            &email_raw,
            5,
            StdDuration::from_secs(60 * 60),
        );
    }

    // Anti-enumeration: pad response time to a uniform window so timing
    // can't reveal whether the email was registered. 80–250 ms is short
    // enough not to be user-hostile while still swamping network jitter.
    let jitter = rand::random::<u64>() % 170;
    tokio::time::sleep(StdDuration::from_millis(80 + jitter)).await;

    Ok(Json(ForgotPasswordResp { ok: true }))
}

pub async fn reset_password(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<ResetPasswordReq>,
) -> Result<Json<ResetPasswordResp>, (StatusCode, String)> {
    if body.new_password.len() < MIN_PASSWORD_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("新密码至少 {} 位", MIN_PASSWORD_LEN),
        ));
    }
    if body.token.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "token 不能为空".into()));
    }

    let token_hash = blake_hash(&body.token);
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT id, user_id, expires_at FROM password_reset_token \
         WHERE token_hash = $1",
    )
    .bind(&token_hash)
    .fetch_optional(pool.as_ref())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (token_id, user_id, expires_at) = match row {
        Some(r) => r,
        None => return Err((StatusCode::BAD_REQUEST, "重置链接无效".into())),
    };

    if expires_at <= now {
        return Err((StatusCode::BAD_REQUEST, "重置链接已过期".into()));
    }

    let pwhash = hash(body.new_password.as_bytes(), DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash: {e}")))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Re-check `used_at` under the row lock so two concurrent resets
    // can't both succeed.
    let used: Option<Option<String>> = sqlx::query_scalar(
        "SELECT used_at FROM password_reset_token WHERE id = $1 FOR UPDATE",
    )
    .bind(&token_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if used.flatten().is_some() {
        return Err((StatusCode::BAD_REQUEST, "重置链接已被使用".into()));
    }

    sqlx::query(
        "UPDATE user_account SET password_hash = $1, updated_at = $2 WHERE id = $3",
    )
    .bind(&pwhash)
    .bind(&now)
    .bind(&user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("update password: {e}")))?;

    sqlx::query("UPDATE password_reset_token SET used_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(&token_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("mark used: {e}")))?;

    // Force re-login on every device.
    sqlx::query(
        "UPDATE refresh_token SET revoked_at = $1 \
         WHERE user_id = $2 AND revoked_at IS NULL",
    )
    .bind(&now)
    .bind(&user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("revoke sessions: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ResetPasswordResp { ok: true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blake_hash_is_stable() {
        assert_eq!(blake_hash("hello").len(), 16);
        assert_eq!(blake_hash("hello"), blake_hash("hello"));
        assert_ne!(blake_hash("hello"), blake_hash("Hello"));
    }

    #[test]
    fn reset_token_length_and_chars() {
        for _ in 0..20 {
            let t = random_reset_token();
            assert_eq!(t.len(), 64);
            assert!(t.chars().all(|c| c.is_ascii_alphanumeric()));
        }
    }

    #[test]
    fn client_ip_prefers_xff() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "1.2.3.4, 10.0.0.1".parse().unwrap());
        h.insert("x-real-ip", "5.6.7.8".parse().unwrap());
        let addr: std::net::SocketAddr = "127.0.0.1:9999".parse().unwrap();
        assert_eq!(client_ip(&h, Some(addr)), "1.2.3.4");
    }

    #[test]
    fn client_ip_falls_back_to_peer() {
        let h = HeaderMap::new();
        let addr: std::net::SocketAddr = "127.0.0.1:9999".parse().unwrap();
        assert_eq!(client_ip(&h, Some(addr)), "127.0.0.1");
    }

    #[test]
    fn client_ip_unknown_when_no_peer() {
        let h = HeaderMap::new();
        assert_eq!(client_ip(&h, None), "unknown");
    }
}
