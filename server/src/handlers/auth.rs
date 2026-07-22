use axum::{
    extract::State,
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
use std::sync::Arc;
use crate::handlers::JWT_KEYS;

pub const ACCESS_TOKEN_TTL_SECS: u64 = 7 * 24 * 60 * 60;
pub const REFRESH_TOKEN_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LEN: usize = 8;

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
    let device_id = uuid::Uuid::new_v4().to_string();
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

    let device_id = uuid::Uuid::new_v4().to_string();
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
