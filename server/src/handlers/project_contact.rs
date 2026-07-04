use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::ProjectContactWithContact;

#[derive(sqlx::FromRow)]
struct ContactWithRole {
    id: String,
    user_id: String,
    nickname: String,
    name: Option<String>,
    company: Option<String>,
    title: Option<String>,
    city: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    wechat: Option<String>,
    notes: Option<String>,
    importance: String,
    reminder_enabled: bool,
    reminder_interval_days: Option<i64>,
    last_contacted_at: Option<String>,
    created_at: String,
    updated_at: String,
    role: Option<String>,
    added_at: String,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ProjectContactWithContact>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, ContactWithRole>(
        "SELECT c.id, c.user_id, c.nickname, c.name, c.company, c.title, c.city, c.email, c.phone, c.wechat, \
                c.notes, c.importance, c.reminder_enabled, c.reminder_interval_days, c.last_contacted_at, \
                c.created_at, c.updated_at, pc.role, pc.added_at \
         FROM project_contact pc \
         JOIN contact c ON c.id = pc.contact_id \
         WHERE pc.project_id = $1 AND pc.user_id = $2",
    )
    .bind(&project_id)
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let result = rows.into_iter().map(|r| ProjectContactWithContact {
        contact: weavine_lib::models::Contact {
            id: r.id,
            user_id: r.user_id,
            nickname: r.nickname,
            name: r.name,
            company: r.company,
            title: r.title,
            city: r.city,
            email: r.email,
            phone: r.phone,
            wechat: r.wechat,
            notes: r.notes,
            importance: r.importance,
            reminder_enabled: r.reminder_enabled,
            reminder_interval_days: r.reminder_interval_days,
            last_contacted_at: r.last_contacted_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            tags: Vec::new(),
        },
        role: r.role,
        added_at: r.added_at,
    }).collect();
    Ok(Json(result))
}

pub async fn add(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(project_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let contact_id = body.get("contact_id").and_then(|v| v.as_str()).unwrap_or("");
    let role = body.get("role").and_then(|v| v.as_str());
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
        "INSERT INTO project_contact (user_id, project_id, contact_id, role, added_at) \
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (project_id, contact_id) DO NOTHING",
    )
    .bind(&auth)
    .bind(&project_id)
    .bind(contact_id)
    .bind(role)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}

pub async fn remove(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((project_id, contact_id)): Path<(String, String)>,
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

    sqlx::query(
        "DELETE FROM project_contact WHERE project_id = $1 AND contact_id = $2 AND user_id = $3",
    )
    .bind(&project_id)
    .bind(&contact_id)
    .bind(&auth)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
