use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;

pub async fn user(
    State(pool): State<Arc<PgPool>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    Ok(Json(json!({
        "id": auth,
        "provider": "jwt"
    })))
}

pub async fn startup(
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&*pool)
        .await
        .is_ok();
    Ok(Json(json!({
        "status": if db_ok { "ok" } else { "db_error" },
        "version": "0.2.0",
        "db": "postgres"
    })))
}
