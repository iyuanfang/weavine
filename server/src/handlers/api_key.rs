use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use argon2::Argon2;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;

use crate::api_key_crypto;
use crate::handlers::auth::extract_auth;
use crate::handlers::now_str;

const KEY_PREFIX: &str = "wvk_";
const KEY_BODY_LEN: usize = 54;

#[derive(Serialize, sqlx::FromRow)]
pub struct ApiKeySummary {
    pub id: String,
    pub name: String,
    #[sqlx(rename = "key_prefix")]
    pub prefix: String,
    #[sqlx(rename = "key_last4")]
    pub last4: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Serialize)]
pub struct ApiKeyCreated {
    #[serde(flatten)]
    pub summary: ApiKeySummary,
    pub key: String,
}

#[derive(Serialize)]
pub struct ApiKeyRevealed {
    pub id: String,
    pub key: String,
}

#[derive(Deserialize)]
pub struct CreateApiKeyReq {
    pub name: String,
}

pub async fn list(
    State(pool): State<Arc<PgPool>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ApiKeySummary>>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let keys: Vec<ApiKeySummary> = sqlx::query_as(
        "SELECT id, name, key_prefix, key_last4, created_at, last_used_at \
         FROM api_key WHERE user_id = $1 AND revoked_at IS NULL \
         ORDER BY created_at DESC",
    )
    .bind(&user_id)
    .fetch_all(pool.as_ref())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("list api_key: {e}")))?;
    Ok(Json(keys))
}

pub async fn create(
    State(pool): State<Arc<PgPool>>,
    headers: HeaderMap,
    Json(req): Json<CreateApiKeyReq>,
) -> Result<Json<ApiKeyCreated>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name 不能为空".to_string()));
    }
    if name.chars().count() > 64 {
        return Err((StatusCode::BAD_REQUEST, "name 过长 (最多 64 字符)".to_string()));
    }
    let body: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(KEY_BODY_LEN)
        .map(char::from)
        .collect();
    let plaintext = format!("{KEY_PREFIX}{body}");
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(plaintext.as_bytes(), &salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash api_key: {e}")))?
        .to_string();
    let created_at = now_str();
    let aad = user_id.as_bytes();
    let (ciphertext, nonce) = api_key_crypto::encrypt(plaintext.as_bytes(), aad);
    let last4: String = plaintext
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let (id,): (String,) = sqlx::query_as(
        "INSERT INTO api_key \
         (user_id, key_hash, key_ciphertext, key_nonce, key_prefix, key_last4, name, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    )
    .bind(&user_id)
    .bind(&hash)
    .bind(&ciphertext)
    .bind(&nonce)
    .bind(KEY_PREFIX)
    .bind(&last4)
    .bind(name)
    .bind(&created_at)
    .fetch_one(pool.as_ref())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert api_key: {e}")))?;
    let summary = ApiKeySummary {
        id,
        name: name.to_string(),
        prefix: KEY_PREFIX.to_string(),
        last4,
        created_at,
        last_used_at: None,
    };
    Ok(Json(ApiKeyCreated { summary, key: plaintext }))
}

pub async fn reveal(
    State(pool): State<Arc<PgPool>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiKeyRevealed>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let row: (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT key_ciphertext, key_nonce FROM api_key \
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(&id)
    .bind(&user_id)
    .fetch_optional(pool.as_ref())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("fetch api_key: {e}")))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "未找到匹配的 api_key".to_string()))?;
    let plaintext = api_key_crypto::decrypt(&row.0, &row.1, user_id.as_bytes())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("decrypt: {e}")))?;
    let key = String::from_utf8(plaintext)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("utf8: {e}")))?;
    Ok(Json(ApiKeyRevealed { id, key }))
}

pub async fn revoke(
    State(pool): State<Arc<PgPool>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let res = sqlx::query(
        "UPDATE api_key SET revoked_at = $1 \
         WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
    )
    .bind(now_str())
    .bind(&id)
    .bind(&user_id)
    .execute(pool.as_ref())
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("revoke api_key: {e}")))?;
    if res.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "未找到匹配的 api_key".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}
