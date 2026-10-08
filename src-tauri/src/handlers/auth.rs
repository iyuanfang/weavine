use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::AppState;

const ACCESS_TOKEN_TTL_SECS: u64 = 15 * 60;
const REFRESH_TOKEN_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LEN: usize = 8;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub exp: u64,
    pub iat: u64,
}

#[derive(Serialize)]
pub struct AuthSession {
    pub user_id: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub user_id: String,
    pub email: String,
}

#[derive(Deserialize)]
pub struct RegisterBody {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshBody {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct LogoutBody {
    pub refresh_token: String,
}

fn jwt_secret() -> Result<Vec<u8>, (StatusCode, String)> {
    match std::env::var("WEAVINE_JWT_SECRET") {
        Ok(v) if v.len() >= 32 => Ok(v.into_bytes()),
        Ok(v) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("WEAVINE_JWT_SECRET must be at least 32 chars, got {}", v.len()),
        )),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "WEAVINE_JWT_SECRET env var not set".to_string(),
        )),
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_secs() as i64
}

fn issue_access_token(secret: &[u8], user_id: &str, email: &str) -> Result<String, (StatusCode, String)> {
    let iat = now() as u64;
    let exp = iat + ACCESS_TOKEN_TTL_SECS;
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        iat,
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("jwt encode: {e}")))
}

fn issue_refresh_token(conn: &rusqlite::Connection, user_id: &str, device: Option<&str>) -> Result<String, (StatusCode, String)> {
    let raw: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let token_hash = blake_hash(&raw);
    let id = uuid::Uuid::new_v4().to_string();
    let ttl = REFRESH_TOKEN_TTL_SECS as i64;
    conn.execute(
        "INSERT INTO \"RefreshToken\" (\"id\", \"user_id\", \"token_hash\", \"device\", \"expires_at\") VALUES (?1, ?2, ?3, ?4, datetime('now', ?5))",
        params![id, user_id, token_hash, device, format!("+{} seconds", ttl)],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert refresh: {e}")))?;
    Ok(raw)
}

fn blake_hash(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn build_session(
    conn: &rusqlite::Connection,
    secret: &[u8],
    user_id: &str,
    email: &str,
    device: Option<&str>,
) -> Result<AuthSession, (StatusCode, String)> {
    let access = issue_access_token(secret, user_id, email)?;
    let refresh = issue_refresh_token(conn, user_id, device)?;
    Ok(AuthSession {
        user_id: user_id.to_string(),
        email: email.to_string(),
        access_token: access,
        refresh_token: refresh,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    })
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let mut parts = raw.splitn(2, ' ');
    let scheme = parts.next()?;
    let token = parts.next()?;
    if scheme.eq_ignore_ascii_case("Bearer") {
        Some(token.to_string())
    } else {
        None
    }
}

fn verify_access(secret: &[u8], token: &str) -> Result<Claims, (StatusCode, String)> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| (StatusCode::UNAUTHORIZED, format!("invalid token: {e}")))
}

pub async fn register(
    State(s): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err((StatusCode::BAD_REQUEST, "邮箱格式不正确".into()));
    }
    if body.password.len() < MIN_PASSWORD_LEN {
        return Err((StatusCode::BAD_REQUEST, format!("密码至少 {} 位", MIN_PASSWORD_LEN)));
    }
    let secret = jwt_secret()?;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT \"id\" FROM \"UserAccount\" WHERE \"email\" = ?1",
            params![email],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "该邮箱已注册".into()));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let hash = hash(body.password.as_bytes(), DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash: {e}")))?;
    conn.execute(
        "INSERT INTO \"UserAccount\" (\"id\", \"email\", \"password_hash\", \"updated_at\") VALUES (?1, ?2, ?3, datetime('now'))",
        params![id, email, hash],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert user: {e}")))?;
    // Mirror to legacy User table — user_id FKs everywhere reference User.id.
    conn.execute(
        "INSERT INTO \"User\" (\"id\", \"email\", \"password_hash\", \"is_local\", \"updated_at\") VALUES (?1, ?2, ?3, 0, datetime('now'))",
        params![id, email, hash],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert User row: {e}")))?;
    let session = build_session(&conn, &secret, &id, &email, None)?;
    Ok(Json(session))
}

pub async fn login(
    State(s): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "邮箱和密码必填".into()));
    }
    let secret = jwt_secret()?;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT \"id\", \"password_hash\" FROM \"UserAccount\" WHERE \"email\" = ?1",
            params![email],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (user_id, hash) = match row {
        Some(r) => r,
        None => return Err((StatusCode::UNAUTHORIZED, "邮箱或密码错误".into())),
    };
    let ok = verify(body.password.as_bytes(), &hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("verify: {e}")))?;
    if !ok {
        return Err((StatusCode::UNAUTHORIZED, "邮箱或密码错误".into()));
    }
    let session = build_session(&conn, &secret, &user_id, &email, None)?;
    Ok(Json(session))
}

pub async fn refresh(
    State(s): State<AppState>,
    Json(body): Json<RefreshBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let secret = jwt_secret()?;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let token_hash = blake_hash(&body.refresh_token);
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT rt.\"user_id\", ua.\"email\" FROM \"RefreshToken\" rt JOIN \"UserAccount\" ua ON ua.\"id\" = rt.\"user_id\" WHERE rt.\"token_hash\" = ?1 AND rt.\"revoked_at\" IS NULL AND rt.\"expires_at\" > datetime('now')",
            params![token_hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (user_id, email) = match row {
        Some(r) => r,
        None => return Err((StatusCode::UNAUTHORIZED, "refresh token 无效或已过期".into())),
    };
    let new_token = issue_refresh_token(&conn, &user_id, None)?;
    let session = AuthSession {
        user_id: user_id.clone(),
        email: email.clone(),
        access_token: issue_access_token(&secret, &user_id, &email)?,
        refresh_token: new_token,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    };
    Ok(Json(session))
}

pub async fn logout(
    State(s): State<AppState>,
    Json(body): Json<LogoutBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let token_hash = blake_hash(&body.refresh_token);
    let changed = conn
        .execute(
            "UPDATE \"RefreshToken\" SET \"revoked_at\" = datetime('now') WHERE \"token_hash\" = ?1 AND \"revoked_at\" IS NULL",
            params![token_hash],
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if changed == 0 {
        return Err((StatusCode::UNAUTHORIZED, "refresh token 不存在".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn me(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let token = extract_bearer(&headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            "missing Authorization header".into(),
        )
    })?;
    let secret = jwt_secret()?;
    let claims = verify_access(&secret, &token)?;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let email: String = conn
        .query_row(
            "SELECT \"email\" FROM \"UserAccount\" WHERE \"id\" = ?1",
            params![claims.sub],
            |row| row.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(MeResponse {
        user_id: claims.sub,
        email,
    }))
}
