use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::Contact;

const MAX_PAGE_SIZE: i64 = 200;
const DEFAULT_PAGE_SIZE: i64 = 20;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub importance: Option<String>,
    pub sort_by: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn validate_sort_by(sort_by: &str) -> &'static str {
    match sort_by {
        "last_contacted_at" => "last_contacted_at DESC NULLS LAST",
        "created_at" => "created_at DESC",
        "nickname" => "nickname ASC",
        _ => "last_contacted_at DESC NULLS LAST",
    }
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let sort_col = validate_sort_by(p.sort_by.as_deref().unwrap_or("last_contacted_at"));
    let limit = p.limit.unwrap_or(DEFAULT_PAGE_SIZE).min(MAX_PAGE_SIZE);
    let offset = p.offset.unwrap_or(0).max(0);

    let count_sql = "SELECT COUNT(*) FROM contact \
        WHERE user_id = $1 \
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR company ILIKE '%' || $2 || '%') \
        AND ($3::text IS NULL OR importance = $3) \
        AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM contact_tag ct WHERE ct.contact_id = contact.id AND ct.tag_id = $4))";
    let total: (i64,) = sqlx::query_as(count_sql)
        .bind(&auth)
        .bind(&p.search)
        .bind(&p.importance)
        .bind(&p.tag_id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let query_sql = format!(
        "SELECT id, user_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, reminder_interval_days::BIGINT AS reminder_interval_days, last_contacted_at, \
         created_at, updated_at \
         FROM contact \
         WHERE user_id = $1 \
         AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR company ILIKE '%' || $2 || '%') \
         AND ($3::text IS NULL OR importance = $3) \
         AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM contact_tag ct WHERE ct.contact_id = contact.id AND ct.tag_id = $4)) \
         ORDER BY {} LIMIT ${} OFFSET ${}",
        sort_col, 5, 6
    );

    let rows = sqlx::query_as::<_, Contact>(&query_sql)
        .bind(&auth)
        .bind(&p.search)
        .bind(&p.importance)
        .bind(&p.tag_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut items: Vec<Contact> = Vec::with_capacity(rows.len());
    for contact in rows {
        let tags = sqlx::query_as::<_, weavine_lib::models::Tag>(
            "SELECT t.id, t.user_id, t.name, t.color, t.created_at \
             FROM tag t JOIN contact_tag ct ON ct.tag_id = t.id WHERE ct.contact_id = $1",
        )
        .bind(&contact.id)
        .fetch_all(&*pool)
        .await
        .unwrap_or_default();
        items.push(Contact { tags, ..contact });
    }
    Ok(Json(json!({ "items": items, "total": total.0 })))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Contact>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let mut contact: Contact = sqlx::query_as(
        "SELECT id, user_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, reminder_interval_days::BIGINT AS reminder_interval_days, last_contacted_at, \
         created_at, updated_at \
         FROM contact WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "联系人不存在".to_string()))?;

    contact.tags = sqlx::query_as(
        "SELECT t.id, t.user_id, t.name, t.color, t.created_at \
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
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let tag_ids = body.get("tag_ids").and_then(|v| v.as_array()).cloned().unwrap_or_default();

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
        "INSERT INTO contact (id, user_id, nickname, name, company, title, city, email, phone, wechat, \
         notes, importance, reminder_enabled, reminder_interval_days, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14,$15)",
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
    .bind(body.get("reminder_interval_days").and_then(|v| v.as_i64()).map(|n| n as i32))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
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
            let ctid = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO contact_tag (id, user_id, contact_id, tag_id) VALUES ($1, $2, $3, $4) \
                 ON CONFLICT (contact_id, tag_id) DO NOTHING",
            )
            .bind(&ctid)
            .bind(&auth)
            .bind(&id)
            .bind(tid)
            .execute(&mut *tx)
            .await;
        }
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    get(headers.clone(), State(pool), Path(id.to_string())).await
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Contact>, (StatusCode, String)> {
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

    enum Bind<'a> {
        Text(&'a str),
        I32(i32),
    }

    let mut sets = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    let mut idx = 1u32;

    if let Some(v) = body.get("nickname").and_then(|v| v.as_str()) {
        sets.push(format!("nickname = ${}", idx)); binds.push(Bind::Text(v)); idx += 1;
    }
    for field in &["name", "company", "title", "city", "email", "phone", "wechat", "notes", "importance"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx)); binds.push(Bind::Text(v)); idx += 1;
        }
    }
    if let Some(v) = body.get("reminder_interval_days").and_then(|v| v.as_i64()) {
        sets.push(format!("reminder_interval_days = ${}", idx));
        binds.push(Bind::I32(v as i32));
        idx += 1;
    }
    sets.push(format!("updated_at = ${}", idx)); binds.push(Bind::Text(&now)); idx += 1;

    let sql = format!(
        "UPDATE contact SET {} WHERE id = ${} AND user_id = ${}",
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
    q.execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(tag_ids) = body.get("tag_ids").and_then(|v| v.as_array()) {
        let _ = sqlx::query("DELETE FROM contact_tag WHERE contact_id = $1")
            .bind(&id).execute(&mut *tx).await;
        for tv in tag_ids {
            if let Some(tid) = tv.as_str() {
                let ctid = uuid::Uuid::new_v4().to_string();
                let _ = sqlx::query(
                    "INSERT INTO contact_tag (id, user_id, contact_id, tag_id) VALUES ($1, $2, $3, $4) \
                     ON CONFLICT (contact_id, tag_id) DO NOTHING",
                )
                .bind(&ctid)
                .bind(&auth)
                .bind(&id)
                .bind(tid)
                .execute(&mut *tx)
                .await;
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    get(headers.clone(), State(pool), Path(id.to_string())).await
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

    let _ = sqlx::query("DELETE FROM contact_tag WHERE contact_id = $1")
        .bind(&id)
        .execute(&mut *tx)
        .await;
    sqlx::query("DELETE FROM contact WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&auth)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
