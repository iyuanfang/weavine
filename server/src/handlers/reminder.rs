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
use weavine_lib::models::Reminder;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub include_dismissed: Option<bool>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Reminder>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Reminder>(
        "SELECT id, owner_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, created_at \
         FROM reminder WHERE owner_id = $1 \
         AND ($2::text IS NULL OR contact_id = $2) \
         AND ($3::text IS NULL OR event_id = $3) \
         AND ($4::bool IS NULL OR $4 = false OR dismissed = $4) \
         ORDER BY trigger_at LIMIT $5",
    )
    .bind(&auth).bind(&p.contact_id).bind(&p.event_id)
    .bind(p.include_dismissed.unwrap_or(false))
    .bind(p.limit.unwrap_or(50))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Reminder>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    sqlx::query(
        "INSERT INTO reminder (id, owner_id, contact_id, event_id, trigger_at, kind, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&id).bind(&auth)
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("event_id").and_then(|v| v.as_str()))
    .bind(body.get("trigger_at").and_then(|v| v.as_str()).unwrap_or(&now))
    .bind(body.get("kind").and_then(|v| v.as_str()).unwrap_or("event"))
    .bind(&now)
    .execute(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let reminder = sqlx::query_as::<_, Reminder>(
        "SELECT id, owner_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, created_at \
         FROM reminder WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(reminder))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Reminder>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let reminder = sqlx::query_as::<_, Reminder>(
        "SELECT id, owner_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, created_at \
         FROM reminder WHERE id = $1 AND owner_id = $2",
    )
    .bind(&id).bind(&auth)
    .fetch_optional(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "提醒不存在".to_string()))?;
    Ok(Json(reminder))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Reminder>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let now = super::now_str();
    let mut sets = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 1u32;
    for field in &["trigger_at", "kind", "contact_id", "event_id"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            params.push(v.to_string()); idx += 1;
        }
    }
    for field in &["dispatched", "dismissed"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_bool()) {
            sets.push(format!("{} = ${}", field, idx));
            params.push(v.to_string()); idx += 1;
        }
    }
    sets.push(format!("created_at = ${}", idx));
    params.push(now); idx += 1;
    let sql = format!("UPDATE reminder SET {} WHERE id = ${} AND owner_id = ${}", sets.join(", "), idx, idx + 1);
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
    sqlx::query("DELETE FROM reminder WHERE id = $1 AND owner_id = $2")
        .bind(&id).bind(&auth)
        .execute(&*pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}

pub async fn dismiss(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    sqlx::query("UPDATE reminder SET dismissed = true WHERE id = $1 AND owner_id = $2")
        .bind(&id).bind(&auth)
        .execute(&*pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
