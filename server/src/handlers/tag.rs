use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use super::now_str;
use weavine_lib::models::Tag;

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    _q: Query<ListParams>,
) -> Result<Json<Vec<Tag>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query_as::<_, Tag>(
        "SELECT id, user_id, name, color, created_at FROM tag WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name",
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
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let color = body.get("color").and_then(|v| v.as_str());

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
        "INSERT INTO tag (id, user_id, name, color, created_at) VALUES ($1,$2,$3,$4,$5)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(name)
    .bind(color)
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

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // `user_id` pin, even though `id` was generated in this very request: the
    // re-read is a copy-paste template for the update path below, where `id`
    // arrives from the path and the same SELECT without the pin returns another
    // user's row. Keep the two identical so the template cannot drift.
    let tag = sqlx::query_as::<_, Tag>("SELECT id, user_id, name, color, created_at FROM tag WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL")
        .bind(&id)
        .bind(&auth)
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
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let now = super::now_str();
    let name = body.get("name").and_then(|v| v.as_str());
    let color = body.get("color").and_then(|v| v.as_str());

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(n) = name {
        sqlx::query("UPDATE tag SET name = $1, color = $2, created_at = $3 WHERE id = $4 AND user_id = $5")
            .bind(n)
            .bind(color)
            .bind(&now)
            .bind(&id)
            .bind(&auth)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // The UPDATE above is correctly scoped, so a foreign id updates zero rows.
    // This re-read used to ignore that and return the *other* user's tag with a
    // 200 — the update was a no-op but the response leaked `name` / `color` /
    // `created_at`. Scoping it makes a foreign id behave like a missing one.
    let tag = sqlx::query_as::<_, Tag>("SELECT id, user_id, name, color, created_at FROM tag WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL")
        .bind(&id)
        .bind(&auth)
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

    // No `updated_at`, deliberately.
    //
    // History, because the first half of this comment is now out of date: the
    // column did not exist when this was written, so writing it made every tag
    // delete fail with `column "updated_at" of relation "tag" does not exist` →
    // 500. Migration 20260926000003 added it (and `tag` joined
    // `UPDATED_AT_TABLES`), so the statement *would* work now — but bumping it
    // is still wrong: the client compares `updated_at` before upserting, so a
    // server-side bump would make every offline client's re-push of this tag
    // look stale and surface as a `server has newer updated_at` conflict. The
    // tombstone cannot be lost either way, because the upsert writes
    // `deleted_at = COALESCE(EXCLUDED.deleted_at, tag.deleted_at)`.
    //
    // `now_str()` rather than SQL `now()`: `deleted_at` is TEXT and is compared
    // as a string, and `now()` serializes with a space separator + microseconds
    // (`2026-09-26 13:37:06.123456+00`) which sorts below every client-written
    // `...T...Z` value on the same day. See `handlers::action`.
    let now = now_str();
    sqlx::query("UPDATE tag SET deleted_at = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL")
        .bind(&id)
        .bind(&auth)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}
