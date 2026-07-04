use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::Interaction;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Interaction>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Interaction>(
        "SELECT id, owner_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM interaction WHERE owner_id = $1 \
         AND ($2::text IS NULL OR contact_id = $2) \
         AND ($3::text IS NULL OR action_id = $3) \
         AND ($4::text IS NULL OR event_id = $4) \
         ORDER BY occurred_at DESC LIMIT $5",
    )
    .bind(&auth).bind(&p.contact_id).bind(&p.action_id)
    .bind(&p.event_id).bind(p.limit.unwrap_or(100))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    sqlx::query(
        "INSERT INTO interaction (id, owner_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(&id).bind(&auth)
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("action_id").and_then(|v| v.as_str()))
    .bind(body.get("event_id").and_then(|v| v.as_str()))
    .bind(body.get("occurred_at").and_then(|v| v.as_str()).unwrap_or(&now))
    .bind(body.get("channel").and_then(|v| v.as_str()))
    .bind(body.get("summary").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(&now)
    .execute(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let interaction = sqlx::query_as::<_, Interaction>(
        "SELECT id, owner_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM interaction WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(interaction))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let interaction = sqlx::query_as::<_, Interaction>(
        "SELECT id, owner_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM interaction WHERE id = $1 AND owner_id = $2",
    )
    .bind(&id).bind(&auth)
    .fetch_optional(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "互动不存在".to_string()))?;
    Ok(Json(interaction))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Interaction>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let now = super::now_str();
    let mut sets = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 1u32;
    for field in &["contact_id", "action_id", "event_id", "occurred_at", "channel", "summary"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            params.push(v.to_string()); idx += 1;
        }
    }
    sets.push(format!("created_at = ${}", idx));
    params.push(now); idx += 1;
    let sql = format!("UPDATE interaction SET {} WHERE id = ${} AND owner_id = ${}", sets.join(", "), idx, idx + 1);
    let mut q = sqlx::query(&sql);
    for p in &params { q = q.bind(p); }
    q = q.bind(&id).bind(&auth);
    q.execute(&*pool).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    get(headers, State(pool), Path(id)).await
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    sqlx::query("DELETE FROM interaction WHERE id = $1 AND owner_id = $2")
        .bind(&id).bind(&auth)
        .execute(&*pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
