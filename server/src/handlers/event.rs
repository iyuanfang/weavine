use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::Event;

const EVENT_SELECT: &str = "SELECT e.id, e.user_id, e.title, e.event_type, e.start_at, e.end_at, e.location, e.notes, \
     e.contact_id, e.project_id, e.reminder_lead_minutes::BIGINT AS reminder_lead_minutes, e.archived_at, e.created_at, e.updated_at, \
     c.nickname AS contact_nickname, p.title AS project_title \
     FROM event e \
     LEFT JOIN contact c ON c.id = e.contact_id AND c.user_id = e.user_id \
     LEFT JOIN project p ON p.id = e.project_id AND p.user_id = e.user_id";

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
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.user_id = $1 \
         AND ($2::text IS NULL OR e.contact_id = $2) \
         AND ($3::text IS NULL OR e.project_id = $3) \
         AND ($4::text IS NULL OR e.start_at >= $4) \
         AND ($5::text IS NULL OR e.start_at <= $5) \
         AND ($6::text IS NULL OR ($6::text = 'true' AND e.archived_at IS NOT NULL) OR ($6::text = 'false' AND e.archived_at IS NULL)) \
         ORDER BY e.start_at DESC LIMIT $7",
    ))
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
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
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
    .bind(body.get("reminder_lead_minutes").and_then(|v| v.as_i64()).map(|n| n as i32))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.id = $1",
    ))
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
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let event = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2",
    ))
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
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
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

    enum Bind<'a> {
        Text(&'a str),
        I32(i32),
    }

    let mut sets = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    let mut idx = 1u32;
    for field in &["title", "event_type", "start_at", "end_at", "location", "notes", "contact_id", "project_id"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            binds.push(Bind::Text(v));
            idx += 1;
        }
    }
    if let Some(v) = body.get("reminder_lead_minutes").and_then(|v| v.as_i64()) {
        sets.push(format!("reminder_lead_minutes = ${}", idx));
        binds.push(Bind::I32(v as i32));
        idx += 1;
    }
    if let Some(v) = body.get("archived_at").and_then(|v| v.as_str()) {
        sets.push(format!("archived_at = ${}", idx));
        binds.push(Bind::Text(v));
        idx += 1;
    }
    sets.push(format!("updated_at = ${}", idx));
    binds.push(Bind::Text(&now));
    idx += 1;
    let sql = format!(
        "UPDATE event SET {} WHERE id = ${} AND user_id = ${}",
        sets.join(", "), idx, idx + 1
    );
    let mut q = sqlx::query(&sql);
    for b in &binds {
        q = match b {
            Bind::Text(s) => q.bind(*s),
            Bind::I32(n) => q.bind(*n),
        };
    }
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
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
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
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let now = super::now_str();
    let rows = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.user_id = $1 AND e.start_at >= $2 AND e.archived_at IS NULL \
         ORDER BY e.start_at LIMIT $3",
    ))
    .bind(&auth).bind(&now)
    .bind(p.limit.unwrap_or(20))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ParticipantRow {
    pub contact_id: String,
    pub role: String,
}

async fn fetch_participants(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
) -> Result<Vec<ParticipantRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT to_id AS contact_id, role FROM entity_links \
         WHERE from_type='event' AND from_id=$1 AND relation_type='participated' \
         ORDER BY created_at ASC"
    )
    .bind(event_id)
    .fetch_all(executor)
    .await
}

async fn sync_main_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
) -> Result<(), sqlx::Error> {
    let first: Option<(String,)> = sqlx::query_as(
        "SELECT to_id FROM entity_links \
         WHERE from_type='event' AND from_id=$1 AND relation_type='participated' \
         ORDER BY created_at ASC LIMIT 1"
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
    .await?;
    sqlx::query("UPDATE event SET contact_id=$1, updated_at=$2 WHERE id=$3")
        .bind(first.map(|(c,)| c))
        .bind(super::now_str())
        .bind(event_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn validate_role(role: &str) -> bool {
    matches!(role, "organizer" | "participant" | "referred" | "mentioned")
}

async fn authorize_event(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
    user_id: &str,
    for_update: bool,
) -> Result<(), (StatusCode, String)> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let q = format!(
        "SELECT user_id FROM event WHERE id=$1 AND deleted_at IS NULL{lock}"
    );
    let owner: Option<(String,)> = sqlx::query_as(&q)
        .bind(event_id)
        .fetch_optional(executor)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match owner {
        Some((u,)) if u == user_id => Ok(()),
        Some(_) => Err((StatusCode::FORBIDDEN, "无权访问".into())),
        None => Err((StatusCode::NOT_FOUND, "事件不存在".into())),
    }
}

pub async fn list_participants(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
) -> Result<Json<Vec<ParticipantRow>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    let rows = fetch_participants(&*pool, &event_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn add_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    let role = if validate_role(&body.role) { body.role.clone() } else { "participant".to_string() };
    sqlx::query(
        "INSERT INTO entity_links (user_id, from_type, from_id, to_type, to_id, relation_type, role) \
         VALUES ($1, 'event', $2, 'contact', $3, 'participated', $4) \
         ON CONFLICT (user_id, from_type, from_id, to_type, to_id, relation_type) \
         DO UPDATE SET role = EXCLUDED.role"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&body.contact_id)
    .bind(&role)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ParticipantRow { contact_id: body.contact_id, role }))
}

pub async fn set_participant_role(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    if !validate_role(&body.role) {
        return Err((StatusCode::BAD_REQUEST, "无效角色".into()));
    }
    let rows = sqlx::query(
        "UPDATE entity_links SET role=$1 \
         WHERE user_id=$2 AND from_type='event' AND from_id=$3 AND to_id=$4 \
           AND relation_type='participated'"
    )
    .bind(&body.role)
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if rows.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "参与者不存在".into()));
    }
    Ok(Json(ParticipantRow { contact_id, role: body.role }))
}

pub async fn remove_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
) -> Result<(StatusCode, ()), (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    sqlx::query(
        "DELETE FROM entity_links \
         WHERE user_id=$1 AND from_type='event' AND from_id=$2 AND to_id=$3 \
           AND relation_type='participated'"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::NO_CONTENT, ()))
}