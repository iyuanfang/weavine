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
use weavine_lib::models::Contact;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub importance: Option<String>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Contact>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Contact>(
        "SELECT id, owner_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, reminder_interval_days, last_contacted_at, \
         created_at, updated_at \
         FROM contact \
         WHERE owner_id = $1 \
         AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR company ILIKE '%' || $2 || '%') \
         AND ($3::text IS NULL OR importance = $3) \
         AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM contact_tag ct WHERE ct.contact_id = contact.id AND ct.tag_id = $4)) \
         ORDER BY created_at DESC",
    )
    .bind(&auth)
    .bind(&p.search)
    .bind(&p.importance)
    .bind(&p.tag_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut result = Vec::with_capacity(rows.len());
    for contact in rows {
        let tags = sqlx::query_as::<_, weavine_lib::models::Tag>(
            "SELECT t.id, t.owner_id, t.name, t.color, t.created_at \
             FROM tag t JOIN contact_tag ct ON ct.tag_id = t.id WHERE ct.contact_id = $1",
        )
        .bind(&contact.id)
        .fetch_all(&*pool)
        .await
        .unwrap_or_default();
        result.push(Contact { tags, ..contact });
    }
    Ok(Json(result))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let mut contact: Contact = sqlx::query_as(
        "SELECT id, owner_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, reminder_interval_days, last_contacted_at, \
         created_at, updated_at \
         FROM contact WHERE id = $1 AND owner_id = $2",
    )
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "联系人不存在".to_string()))?;

    contact.tags = sqlx::query_as(
        "SELECT t.id, t.owner_id, t.name, t.color, t.created_at \
         FROM tag t JOIN contact_tag ct ON ct.tag_id = t.id WHERE ct.contact_id = $1",
    )
    .bind(&id)
    .fetch_all(&*pool)
    .await
    .unwrap_or_default();
    Ok(Json(contact))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let tag_ids = body.get("tag_ids").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    sqlx::query(
        "INSERT INTO contact (id, owner_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(body.get("nickname").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("company").and_then(|v| v.as_str()))
    .bind(body.get("title").and_then(|v| v.as_str()))
    .bind(body.get("city").and_then(|v| v.as_str()))
    .bind(body.get("email").and_then(|v| v.as_str()))
    .bind(body.get("phone").and_then(|v| v.as_str()))
    .bind(body.get("wechat").and_then(|v| v.as_str()))
    .bind(body.get("notes").and_then(|v| v.as_str()))
    .bind(body.get("importance").and_then(|v| v.as_str()).unwrap_or("medium"))
    .bind(&now)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| {
        let msg = e.to_string();
        if msg.contains("unique") || msg.contains("duplicate") {
            (StatusCode::CONFLICT, msg)
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, msg)
        }
    })?;

    for tv in &tag_ids {
        if let Some(tid) = tv.as_str() {
            let _ = sqlx::query("INSERT INTO contact_tag (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                .bind(&id).bind(tid).execute(&*pool).await;
        }
    }

    get(headers.clone(), State(pool), Path(id)).await
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let now = super::now_str();

    let mut sets = Vec::new();
    let mut params: Vec<String> = Vec::new();
    let mut idx = 1u32;

    if let Some(v) = body.get("nickname").and_then(|v| v.as_str()) {
        sets.push(format!("nickname = ${}", idx)); params.push(v.to_string()); idx += 1;
    }
    for field in &["name", "company", "title", "city", "email", "phone", "wechat", "notes", "importance"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx)); params.push(v.to_string()); idx += 1;
        }
    }
    sets.push(format!("updated_at = ${}", idx)); params.push(now.clone()); idx += 1;

    let sql = format!(
        "UPDATE contact SET {} WHERE id = ${} AND owner_id = ${}",
        sets.join(", "), idx, idx + 1
    );

    let mut q = sqlx::query(&sql);
    for p in &params {
        q = q.bind(p);
    }
    q = q.bind(&id).bind(&auth);
    q.execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(tag_ids) = body.get("tag_ids").and_then(|v| v.as_array()) {
        let _ = sqlx::query("DELETE FROM contact_tag WHERE contact_id = $1")
            .bind(&id).execute(&*pool).await;
        for tv in tag_ids {
            if let Some(tid) = tv.as_str() {
                let _ = sqlx::query("INSERT INTO contact_tag (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                    .bind(&id).bind(tid).execute(&*pool).await;
            }
        }
    }

    get(headers.clone(), State(pool), Path(id)).await
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let _ = sqlx::query("DELETE FROM contact_tag WHERE contact_id = $1")
        .bind(&id)
        .execute(&*pool)
        .await;
    sqlx::query("DELETE FROM contact WHERE id = $1 AND owner_id = $2")
        .bind(&id)
        .bind(&auth)
        .execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
