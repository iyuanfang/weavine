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
use weavine_lib::models::Project;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub template: Option<String>,
    pub stage: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Project>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let mut sql = "SELECT id, user_id, title, description, template, stage, \
                    start_at, due_at, completed_at, archived_at, created_at, updated_at \
                    FROM project WHERE user_id = $1".to_string();
    let mut idx = 2u32;

    if let Some(ref t) = p.template {
        sql.push_str(&format!(" AND template = ${}", idx)); idx += 1;
    }
    if let Some(ref s) = p.stage {
        sql.push_str(&format!(" AND stage = ${}", idx)); idx += 1;
    }
    if let Some(ref a) = p.archived {
        if a == "true" {
            sql.push_str(" AND archived_at IS NOT NULL");
        } else {
            sql.push_str(" AND archived_at IS NULL");
        }
    }
    sql.push_str(" ORDER BY created_at DESC");
    if let Some(limit) = p.limit {
        sql.push_str(&format!(" LIMIT ${}", idx));
    }

    let mut q = sqlx::query_as::<_, Project>(&sql).bind(&auth);
    if let Some(ref t) = p.template { q = q.bind(t); }
    if let Some(ref s) = p.stage { q = q.bind(s); }
    if let Some(limit) = p.limit { q = q.bind(limit); }

    let rows = q.fetch_all(&*pool).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let project: Project = sqlx::query_as(
        "SELECT id, user_id, title, description, template, stage, \
         start_at, due_at, completed_at, archived_at, created_at, updated_at \
         FROM project WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "项目不存在".to_string()))?;
    Ok(Json(project))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<Project>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let template = body.get("template").and_then(|v| v.as_str()).unwrap_or("general");
    let default_stage = weavine_lib::project_template::Template::from_str_opt(template)
        .and_then(|t| t.stages().first().map(|s| s.to_string()))
        .unwrap_or_else(|| "待启动".to_string());
    let stage = body
        .get("stage")
        .and_then(|v| v.as_str())
        .unwrap_or(&default_stage);

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
        "INSERT INTO project (id, user_id, title, description, template, stage, \
         start_at, due_at, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(body.get("title").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .bind(template)
    .bind(stage)
    .bind(body.get("start_at").and_then(|v| v.as_str()))
    .bind(body.get("due_at").and_then(|v| v.as_str()))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    get(headers, State(pool), Path(id.to_string())).await
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Project>, (StatusCode, String)> {
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

    for field in &["title", "description", "stage", "start_at", "due_at", "completed_at", "archived_at"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            params.push(v.to_string());
            idx += 1;
        }
    }
    sets.push(format!("updated_at = ${}", idx));
    params.push(now);
    idx += 1;

    let sql = format!(
        "UPDATE project SET {} WHERE id = ${} AND user_id = ${}",
        sets.join(", "), idx, idx + 1
    );
    let mut q = sqlx::query(&sql);
    for p in &params { q = q.bind(p); }
    q = q.bind(&id).bind(&auth);

    q.execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    get(headers, State(pool), Path(id.to_string())).await
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

    sqlx::query("DELETE FROM project WHERE id = $1 AND user_id = $2")
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

pub async fn stages(
    Query(p): Query<Value>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let template = p.get("template").and_then(|v| v.as_str()).unwrap_or("general");
    weavine_lib::project_template::Template::from_str_opt(template)
        .map(|t| Json(t.stages().iter().map(|s| s.to_string()).collect()))
        .ok_or((StatusCode::BAD_REQUEST, format!("unknown template: {template}")))
}
