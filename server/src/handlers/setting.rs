use axum::{
    extract::{State, Query},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::Setting;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
}

#[derive(Deserialize)]
pub struct DeleteParams {
    pub user_id: Option<String>,
    /// The setting to remove. **Required** — see `delete`.
    pub key: Option<String>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    _q: Query<ListParams>,
) -> Result<Json<Vec<Setting>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query_as::<_, Setting>(
        "SELECT id, user_id, key, value, updated_at FROM setting WHERE user_id = $1",
    )
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn upsert(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Setting>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let key = body.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let value = body.get("value").and_then(|v| v.as_str()).unwrap_or("");

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
        "INSERT INTO setting (id, user_id, key, value, updated_at) \
         VALUES ($1,$2,$3,$4,$5) \
         ON CONFLICT (user_id, key) DO UPDATE SET value = $4, updated_at = $5",
    )
    .bind(&id)
    .bind(&auth)
    .bind(key)
    .bind(value)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row = sqlx::query_as::<_, Setting>(
        "SELECT id, user_id, key, value, updated_at FROM setting WHERE user_id = $1 AND key = $2",
    )
    .bind(&auth)
    .bind(key)
    .fetch_one(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(row))
}

/// Delete one setting.
///
/// Scoped to `key` on purpose. The handler used to run
/// `DELETE FROM setting WHERE user_id = $1` — every key the user had — from a
/// request whose only caller passes a single key (the web adapter sends
/// `DELETE /api/settings?user_id=…&key=…`). Nothing calls it yet, so no data was
/// lost, but the next caller would have found out the hard way: this is the same
/// table the archive-retention override lives in, so a stray "clear my theme
/// preference" would silently reset retention to the default — and that setting
/// drives a hard delete.
///
/// A missing `key` is a 400 rather than "delete everything": there is no
/// legitimate bulk-wipe use for this route, and refusing is recoverable while a
/// wipe is not. (`user_id` is ignored either way — the account always comes from
/// the bearer token, never from the query string.)
pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(q): Query<DeleteParams>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;

    let key = q.key.as_deref().map(str::trim).filter(|k| !k.is_empty());
    let key = key.ok_or((
        StatusCode::BAD_REQUEST,
        "`key` is required — this route deletes one setting, not all of them".to_string(),
    ))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM setting WHERE user_id = $1 AND key = $2")
        .bind(&auth)
        .bind(key)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}
