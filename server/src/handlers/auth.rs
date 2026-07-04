use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;

pub const ACCESS_TOKEN_TTL_SECS: u64 = 15 * 60;
pub const REFRESH_TOKEN_TTL_SECS: u64 = 30 * 24 * 60 * 60;
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

pub fn extract_auth(headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let secret = jwt_secret()?;
    let token =
        extract_bearer(headers).ok_or((StatusCode::UNAUTHORIZED, "未登录".to_string()))?;
    let claims =
        verify_access(&secret, &token).map_err(|_| (StatusCode::UNAUTHORIZED, "token 无效或已过期".to_string()))?;
    Ok(claims.sub)
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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time")
        .as_secs() as i64
}

fn issue_access_token(
    secret: &[u8],
    user_id: &str,
    email: &str,
) -> Result<String, (StatusCode, String)> {
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

async fn issue_refresh_token(
    pool: &PgPool,
    user_id: &str,
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
        "INSERT INTO refresh_token (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(&token_hash)
    .bind(&expires_at)
    .bind(&now)
    .execute(pool)
    .await
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

fn verify_access(
    secret: &[u8],
    token: &str,
) -> Result<Claims, (StatusCode, String)> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| (StatusCode::UNAUTHORIZED, format!("invalid token: {e}")))
}

pub async fn register(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<RegisterBody>,
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
    let secret = jwt_secret()?;

    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM user_account WHERE email = $1")
        .bind(&email)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "该邮箱已注册".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let pwhash = hash(body.password.as_bytes(), DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash: {e}")))?;
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&id)
    .bind(&email)
    .bind(&pwhash)
    .bind(&now)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert user: {e}")))?;

    let access = issue_access_token(&secret, &id, &email)?;
    let refresh = issue_refresh_token(&pool, &id).await?;
    Ok(Json(AuthSession {
        user_id: id,
        email,
        access_token: access,
        refresh_token: refresh,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

pub async fn login(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<LoginBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "邮箱和密码必填".into()));
    }
    let secret = jwt_secret()?;

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

    let access = issue_access_token(&secret, &user_id, &email)?;
    let refresh = issue_refresh_token(&pool, &user_id).await?;
    Ok(Json(AuthSession {
        user_id,
        email,
        access_token: access,
        refresh_token: refresh,
        expires_in: ACCESS_TOKEN_TTL_SECS,
    }))
}

pub async fn refresh(
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<RefreshBody>,
) -> Result<Json<AuthSession>, (StatusCode, String)> {
    let secret = jwt_secret()?;
    let token_hash = blake_hash(&body.refresh_token);

    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT rt.user_id, ua.email \
         FROM refresh_token rt \
         JOIN user_account ua ON ua.id = rt.user_id \
         WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > $2",
    )
    .bind(&token_hash)
    .bind(&now)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, email) = match row {
        Some(r) => r,
        None => return Err((StatusCode::UNAUTHORIZED, "refresh token 无效或已过期".into())),
    };

    let access = issue_access_token(&secret, &user_id, &email)?;
    let refresh = issue_refresh_token(&pool, &user_id).await?;
    Ok(Json(AuthSession {
        user_id,
        email,
        access_token: access,
        refresh_token: refresh,
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
    let auth = extract_auth(&headers)?;
    let email: Option<String> =
        sqlx::query_scalar("SELECT email FROM user_account WHERE id = $1")
            .bind(&auth)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let email = email.ok_or((StatusCode::UNAUTHORIZED, "用户不存在".to_string()))?;
    Ok(Json(MeResponse {
        user_id: auth,
        email,
    }))
}
