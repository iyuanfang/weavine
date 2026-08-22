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

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub entity: Option<String>,
    pub limit: Option<i64>,
}

const MAX_LIMIT: i64 = 500;

async fn lazy_sweep(pool: &PgPool, user_id: &str) {
    let res = crate::business::archive_sweep::sweep_user_if_stale(
        pool,
        user_id,
        chrono::Utc::now(),
    )
    .await;
    if let Err(e) = res {
        eprintln!("[archive] lazy sweep failed for user {user_id}: {e}");
    }
}

pub async fn sweep(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let archived = crate::business::archive_sweep::sweep_user(&pool, &auth, chrono::Utc::now())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "archived": archived })))
}

async fn count_table(
    pool: &PgPool,
    user_id: &str,
    table: &str,
    since: Option<&str>,
) -> Result<i64, (StatusCode, String)> {
    let sql = match since {
        Some(_) => format!(
            "SELECT COUNT(*) FROM {table} \
             WHERE user_id = $1 AND archived_at IS NOT NULL AND archived_at >= $2"
        ),
        None => format!(
            "SELECT COUNT(*) FROM {table} \
             WHERE user_id = $1 AND archived_at IS NOT NULL"
        ),
    };
    let q = sqlx::query_scalar::<_, i64>(&sql);
    let q = match since {
        Some(s) => q.bind(user_id).bind(s),
        None => q.bind(user_id),
    };
    q.fetch_one(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn archive_summary(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    lazy_sweep(&pool, &auth).await;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(30))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let action_count = count_table(&pool, &auth, "action", None).await?;
    let event_count = count_table(&pool, &auth, "event", None).await?;
    let project_count = count_table(&pool, &auth, "project", None).await?;
    let action_30d = count_table(&pool, &auth, "action", Some(&cutoff)).await?;
    let event_30d = count_table(&pool, &auth, "event", Some(&cutoff)).await?;
    let project_30d = count_table(&pool, &auth, "project", Some(&cutoff)).await?;

    Ok(Json(json!({
        "action_count": action_count,
        "event_count": event_count,
        "project_count": project_count,
        "action_30d": action_30d,
        "event_30d": event_30d,
        "project_30d": project_30d,
    })))
}

pub async fn archive_counts(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    lazy_sweep(&pool, &auth).await;
    let action = count_table(&pool, &auth, "action", None).await?;
    let event = count_table(&pool, &auth, "event", None).await?;
    let project = count_table(&pool, &auth, "project", None).await?;
    Ok(Json(json!({
        "action": action,
        "event": event,
        "project": project,
    })))
}

pub async fn archive_list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    lazy_sweep(&pool, &auth).await;
    let entity = p.entity.as_deref().unwrap_or("");
    let limit = p.limit.unwrap_or(50).min(MAX_LIMIT);

    // Project to {id, title, archived_at} via json!() — the 3 tables have
    // different column shapes (3 separate FROM clauses below), so a single
    // sqlx::FromRow struct can't hold all 3. Mirrors Tauri archive_list at
    // src-tauri/src/handlers/archive.rs:148-183.
    let table = match entity {
        "action" => "action",
        "event" => "event",
        "project" => "project",
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };

    let sql = format!(
        "SELECT id, title, archived_at FROM {table} \
         WHERE user_id = $1 AND archived_at IS NOT NULL \
         ORDER BY archived_at DESC LIMIT $2"
    );
    let rows: Vec<(String, String, String)> = sqlx::query_as(&sql)
        .bind(&auth)
        .bind(limit)
        .fetch_all(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let items: Vec<Value> = rows
        .into_iter()
        .map(|(id, title, archived_at)| json!({ "id": id, "title": title, "archived_at": archived_at }))
        .collect();
    Ok(Json(items))
}

pub async fn unarchive_one(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = super::auth::extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = body.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let entity = body.get("entity").and_then(|v| v.as_str()).unwrap_or("");
    let table = match entity {
        "action" => "action",
        "event" => "event",
        "project" => "project",
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sql = format!("UPDATE {table} SET archived_at = NULL WHERE id = $1 AND user_id = $2");
    sqlx::query(&sql)
        .bind(id)
        .bind(&auth)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}

pub async fn bulk_unarchive(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<()>, (StatusCode, String)> {
    let (auth, device_id) = super::auth::extract_auth_with_device(&headers, pool.as_ref()).await?;
    let entity = body.get("entity").and_then(|v| v.as_str()).unwrap_or("");
    let table = match entity {
        "action" => "action",
        "event" => "event",
        "project" => "project",
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sql = format!("UPDATE {table} SET archived_at = NULL WHERE user_id = $1 AND archived_at IS NOT NULL");
    sqlx::query(&sql)
        .bind(&auth)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(()))
}
