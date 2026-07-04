use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::Project;

#[derive(Deserialize)]
pub struct ListParams {
    pub owner_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn archive_summary(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM project WHERE owner_id = $1 AND archived_at IS NOT NULL",
    )
    .bind(&auth)
    .fetch_one(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let by_template = sqlx::query_as::<_, (String, i64)>(
        "SELECT template, COUNT(*) as cnt FROM project \
         WHERE owner_id = $1 AND archived_at IS NOT NULL \
         GROUP BY template ORDER BY cnt DESC",
    )
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "total": total, "by_template": by_template })))
}

pub async fn archive_counts(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT template, COUNT(*) as cnt FROM project \
         WHERE owner_id = $1 AND archived_at IS NOT NULL \
         GROUP BY template ORDER BY cnt DESC",
    )
    .bind(&auth)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "counts": rows })))
}

pub async fn archive_list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Project>>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let rows = sqlx::query_as::<_, Project>(
        "SELECT id, owner_id, title, description, template, stage, \
                start_at, due_at, completed_at, archived_at, created_at, updated_at \
         FROM project WHERE owner_id = $1 AND archived_at IS NOT NULL \
         ORDER BY archived_at DESC LIMIT $2",
    )
    .bind(&auth)
    .bind(p.limit.unwrap_or(50))
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn unarchive_one(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    sqlx::query("UPDATE project SET archived_at = NULL WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(&auth)
        .execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}

pub async fn bulk_unarchive(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    if let Some(ids) = body.get("ids").and_then(|v| v.as_array()) {
        for v in ids {
            if let Some(id) = v.as_str() {
                let _ = sqlx::query("UPDATE project SET archived_at = NULL WHERE id = $1 AND owner_id = $2")
                    .bind(id).bind(&auth).execute(&*pool).await;
            }
        }
    }
    Ok(Json(()))
}
