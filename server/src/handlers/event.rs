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
use weavine_lib::models::Event;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub start_after: Option<String>,
    pub start_before: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct UpcomingParams {
    pub user_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Event>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Event>(
        "SELECT id, user_id, title, event_type, start_at, end_at, location, notes, \
                contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
         FROM event WHERE user_id = $1 \
         AND ($2::text IS NULL OR contact_id = $2) \
         AND ($3::text IS NULL OR project_id = $3) \
         AND ($4::text IS NULL OR start_at >= $4) \
         AND ($5::text IS NULL OR start_at <= $5) \
         AND ($6::text IS NULL OR archived_at IS NOT NULL) \
         ORDER BY start_at DESC LIMIT $7",
    )
    .bind(&auth)
    .bind(&p.contact_id)
    .bind(&p.project_id)
    .bind(&p.start_after)
    .bind(&p.start_before)
    .bind(&p.archived)
    .bind(p.limit.unwrap_or(100))
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Event>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query(
        "INSERT INTO event (id, user_id, title, event_type, start_at, end_at, location, notes, \
         contact_id, project_id, reminder_lead_minutes, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(body.get("title").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(body.get("type").or_else(|| body.get("event_type")).and_then(|v| v.as_str()).unwrap_or("event"))
    .bind(body.get("start_at").and_then(|v| v.as_str()).unwrap_or(&now))
    .bind(body.get("end_at").and_then(|v| v.as_str()))
    .bind(body.get("location").and_then(|v| v.as_str()))
    .bind(body.get("notes").and_then(|v| v.as_str()))
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("project_id").and_then(|v| v.as_str()))
    .bind(body.get("reminder_lead_minutes").and_then(|v| v.as_i64()))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event = sqlx::query_as::<_, Event>(
        "SELECT id, user_id, title, event_type, start_at, end_at, location, notes, \
                contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
         FROM event WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(event))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Event>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let event = sqlx::query_as::<_, Event>(
        "SELECT id, user_id, title, event_type, start_at, end_at, location, notes, \
                contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
         FROM event WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "事件不存在".to_string()))?;
    Ok(Json(event))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Event>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let now = super::now_str();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut sets = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 1u32;
    for field in &["title", "event_type", "start_at", "end_at", "location", "notes", "contact_id", "project_id"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            params.push(v.to_string());
            idx += 1;
        }
    }
    if let Some(v) = body.get("reminder_lead_minutes").and_then(|v| v.as_i64()) {
        sets.push(format!("reminder_lead_minutes = ${}", idx));
        params.push(v.to_string());
        idx += 1;
    }
    if let Some(v) = body.get("archived_at").and_then(|v| v.as_str()) {
        sets.push(format!("archived_at = ${}", idx));
        params.push(v.to_string());
        idx += 1;
    }
    sets.push(format!("updated_at = ${}", idx));
    params.push(now);
    idx += 1;
    let sql = format!(
        "UPDATE event SET {} WHERE id = ${} AND user_id = ${}",
        sets.join(", "), idx, idx + 1
    );
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
        .bind(&device_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM event WHERE id = $1 AND user_id = $2")
        .bind(&id).bind(&auth)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}

pub async fn upcoming(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<UpcomingParams>,
) -> Result<Json<Vec<Event>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let now = super::now_str();
    let rows = sqlx::query_as::<_, Event>(
        "SELECT id, user_id, title, event_type, start_at, end_at, location, notes, \
                contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
         FROM event WHERE user_id = $1 AND start_at >= $2 AND archived_at IS NULL \
         ORDER BY start_at LIMIT $3",
    )
    .bind(&auth).bind(&now)
    .bind(p.limit.unwrap_or(20))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}
