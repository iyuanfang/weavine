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
use weavine_lib::models::Action;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub status: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Action>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Action>(
        "SELECT id, user_id, title, description, status, priority::BIGINT AS priority, category, due_at, \
                contact_id, project_id, completed_at, archived_at, created_at, updated_at \
         FROM action WHERE user_id = $1 \
         AND ($2::text IS NULL OR status = $2) \
         AND ($3::text IS NULL OR contact_id = $3) \
         AND ($4::text IS NULL OR project_id = $4) \
         AND ($5::text IS NULL OR ($5::text = 'true' AND archived_at IS NOT NULL) OR ($5::text = 'false' AND archived_at IS NULL)) \
         ORDER BY created_at DESC LIMIT $6",
    )
    .bind(&auth).bind(&p.status).bind(&p.contact_id)
    .bind(&p.project_id).bind(&p.archived)
    .bind(p.limit.unwrap_or(100))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Action>, (StatusCode, String)> {
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
        "INSERT INTO action (id, user_id, title, description, status, priority, category, due_at, \
         contact_id, project_id, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(&id).bind(&auth)
    .bind(body.get("title").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .bind(body.get("status").and_then(|v| v.as_str()).unwrap_or("inbox"))
    .bind(body.get("priority").and_then(|v| v.as_i64()).map(|n| n as i32).unwrap_or(0i32))
    .bind(body.get("category").and_then(|v| v.as_str()))
    .bind(body.get("due_at").and_then(|v| v.as_str()))
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("project_id").and_then(|v| v.as_str()))
    .bind(&now).bind(&now)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let action = sqlx::query_as::<_, Action>(
        "SELECT id, user_id, title, description, status, priority::BIGINT AS priority, category, due_at, \
                contact_id, project_id, completed_at, archived_at, created_at, updated_at \
         FROM action WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(action))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Action>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let action = sqlx::query_as::<_, Action>(
        "SELECT id, user_id, title, description, status, priority::BIGINT AS priority, category, due_at, \
                contact_id, project_id, completed_at, archived_at, created_at, updated_at \
         FROM action WHERE id = $1 AND user_id = $2",
    )
    .bind(&id).bind(&auth)
    .fetch_optional(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "行动不存在".to_string()))?;
    Ok(Json(action))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Action>, (StatusCode, String)> {
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
    for field in &["title", "description", "status", "category", "due_at", "contact_id", "project_id", "completed_at", "archived_at"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            binds.push(Bind::Text(v));
            idx += 1;
        }
    }
    if let Some(v) = body.get("priority").and_then(|v| v.as_i64()) {
        sets.push(format!("priority = ${}", idx));
        binds.push(Bind::I32(v as i32));
        idx += 1;
    }
    sets.push(format!("updated_at = ${}", idx));
    binds.push(Bind::Text(&now));
    let where_id_idx = idx + 1;
    let where_auth_idx = idx + 2;
    let sql = format!("UPDATE action SET {} WHERE id = ${} AND user_id = ${}", sets.join(", "), where_id_idx, where_auth_idx);
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

    sqlx::query("DELETE FROM action WHERE id = $1 AND user_id = $2")
        .bind(&id).bind(&auth)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}
