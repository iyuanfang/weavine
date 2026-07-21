use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::Reminder;

const REMINDER_SELECT: &str = "SELECT r.id, r.user_id, r.contact_id, r.event_id, r.trigger_at, r.kind, r.dispatched, r.dismissed, r.created_at, \
     c.nickname AS contact_nickname \
     FROM reminder r \
     LEFT JOIN contact c ON c.id = r.contact_id AND c.user_id = r.user_id";

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
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
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query_as::<_, Reminder>(&format!(
        "{REMINDER_SELECT} WHERE r.user_id = $1 \
         AND ($2::text IS NULL OR r.contact_id = $2) \
         AND ($3::text IS NULL OR r.event_id = $3) \
         AND ($4::bool IS NULL OR $4 = false OR r.dismissed = $4) \
         ORDER BY r.trigger_at LIMIT $5",
    ))
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
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();

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
        "INSERT INTO reminder (id, user_id, contact_id, event_id, trigger_at, kind, created_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(&id).bind(&auth)
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("event_id").and_then(|v| v.as_str()))
    .bind(body.get("trigger_at").and_then(|v| v.as_str()).unwrap_or(&now))
    .bind(body.get("kind").and_then(|v| v.as_str()).unwrap_or("event"))
    .bind(&now)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let reminder = sqlx::query_as::<_, Reminder>(&format!(
        "{REMINDER_SELECT} WHERE r.id = $1",
    ))
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
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let reminder = sqlx::query_as::<_, Reminder>(&format!(
        "{REMINDER_SELECT} WHERE r.id = $1 AND r.user_id = $2",
    ))
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
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let now = super::now_str();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

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
    let sql = format!("UPDATE reminder SET {} WHERE id = ${} AND user_id = ${}", sets.join(", "), idx, idx + 1);
    let mut q = sqlx::query(&sql);
    for p in &params { q = q.bind(p); }
    q = q.bind(&id).bind(&auth);
    q.execute(&mut *tx).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    get(headers, State(pool), Path(id)).await
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM reminder WHERE id = $1 AND user_id = $2")
        .bind(&id).bind(&auth)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}

pub async fn dismiss(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE reminder SET dismissed = true WHERE id = $1 AND user_id = $2")
        .bind(&id).bind(&auth)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}
