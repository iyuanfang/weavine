use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::Tag;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    _q: Query<ListParams>,
) -> Result<Json<Vec<Tag>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Tag>(
        "SELECT id, owner_id, name, color, created_at FROM tag WHERE owner_id = $1 ORDER BY name",
    )
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Tag>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let color = body.get("color").and_then(|v| v.as_str());

    sqlx::query(
        "INSERT INTO tag (id, owner_id, name, color, created_at) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(name)
    .bind(color)
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

    let tag = sqlx::query_as::<_, Tag>("SELECT id, owner_id, name, color, created_at FROM tag WHERE id = $1")
        .bind(&id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(tag))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Tag>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let now = super::now_str();
    let name = body.get("name").and_then(|v| v.as_str());
    let color = body.get("color").and_then(|v| v.as_str());

    if let Some(n) = name {
        sqlx::query("UPDATE tag SET name = $1, color = $2, created_at = $3 WHERE id = $4 AND owner_id = $5")
            .bind(n)
            .bind(color)
            .bind(&now)
            .bind(&id)
            .bind(&auth)
            .execute(&*pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let tag = sqlx::query_as::<_, Tag>("SELECT id, owner_id, name, color, created_at FROM tag WHERE id = $1")
        .bind(&id)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "标签不存在".to_string()))?;
    Ok(Json(tag))
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    sqlx::query("DELETE FROM tag WHERE id = $1 AND owner_id = $2")
        .bind(&id)
        .bind(&auth)
        .execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
