use axum::{
    extract::{State, Query},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::Setting;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    _q: Query<ListParams>,
) -> Result<Json<Vec<Setting>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Setting>(
        "SELECT id, owner_id, key, value, updated_at FROM setting WHERE owner_id = $1",
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
    let auth = extract_auth(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let key = body.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let value = body.get("value").and_then(|v| v.as_str()).unwrap_or("");

    sqlx::query(
        "INSERT INTO setting (id, owner_id, key, value, updated_at) \
         VALUES ($1,$2,$3,$4,$5) \
         ON CONFLICT (owner_id, key) DO UPDATE SET value = $4, updated_at = $5",
    )
    .bind(&id)
    .bind(&auth)
    .bind(key)
    .bind(value)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row = sqlx::query_as::<_, Setting>(
        "SELECT id, owner_id, key, value, updated_at FROM setting WHERE owner_id = $1 AND key = $2",
    )
    .bind(&auth)
    .bind(key)
    .fetch_one(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(row))
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    sqlx::query("DELETE FROM setting WHERE owner_id = $1")
        .bind(&auth)
        .execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
