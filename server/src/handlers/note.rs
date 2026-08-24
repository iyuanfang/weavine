use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::{CreateNoteInput, Note, NoteBacklink, NoteEntityLink, UpdateNoteInput};

#[derive(Deserialize)]
pub struct ListQuery {
    pub archived: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct BacklinksQuery {
    pub entity_type: String,
    pub entity_id: String,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<Note>>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let include_archived = q.archived.unwrap_or(false);
    let sql = if include_archived {
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE user_id = $1 \
         ORDER BY updated_at DESC LIMIT $2"
    } else {
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE user_id = $1 AND archived_at IS NULL \
         ORDER BY updated_at DESC LIMIT $2"
    };
    let notes = sqlx::query_as::<_, Note>(sql)
        .bind(&user_id)
        .bind(limit)
        .fetch_all(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    Ok(Json(notes))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let note = sqlx::query_as::<_, Note>(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "note not found".into()))?;
    Ok(Json(note))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(input): Json<CreateNoteInput>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let (user_id, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now: DateTime<Utc> = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tx: {e}")))?;
    sqlx::query(
        "INSERT INTO note (id, user_id, title, body, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $5)",
    )
    .bind(&id)
    .bind(&user_id)
    .bind(&input.title)
    .bind(&input.body)
    .bind(&now_str)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert: {e}")))?;

    for link in &input.entity_links {
        sqlx::query(
            "INSERT INTO note_entity (id, note_id, user_id, entity_type, entity_id) \
             VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (note_id, entity_type, entity_id) DO NOTHING",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&id)
        .bind(&user_id)
        .bind(&link.entity_type)
        .bind(&link.entity_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("link: {e}")))?;
    }

    let note = sqlx::query_as::<_, Note>(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("reload: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("commit: {e}")))?;
    Ok(Json(note))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(input): Json<UpdateNoteInput>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let (user_id, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let now: DateTime<Utc> = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tx: {e}")))?;

    let res = sqlx::query(
        "UPDATE note SET \
            title      = COALESCE($3, title), \
            body       = COALESCE($4, body),  \
            updated_at = $5, \
            archived_at = CASE WHEN $6::bool THEN $5 ELSE NULL END \
         WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&user_id)
    .bind(&input.title)
    .bind(&input.body)
    .bind(&now_str)
    .bind(input.archived.unwrap_or(false))
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("update: {e}")))?;
    if res.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "note not found".into()));
    }

    if let Some(links) = &input.entity_links {
        sqlx::query("DELETE FROM note_entity WHERE note_id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("unlink: {e}")))?;
        for link in links {
            sqlx::query(
                "INSERT INTO note_entity (id, note_id, user_id, entity_type, entity_id) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (note_id, entity_type, entity_id) DO NOTHING",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&id)
            .bind(&user_id)
            .bind(&link.entity_type)
            .bind(&link.entity_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("link: {e}")))?;
        }
    }

    let note = sqlx::query_as::<_, Note>(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("reload: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("commit: {e}")))?;
    Ok(Json(note))
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let (user_id, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let res = sqlx::query("DELETE FROM note WHERE id = $1 AND user_id = $2")
        .bind(&id)
        .bind(&user_id)
        .execute(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("delete: {e}")))?;
    if res.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "note not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_backlinks(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(q): Query<BacklinksQuery>,
) -> Result<Json<Vec<NoteBacklink>>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query(
        "SELECT n.id, n.title, substr(n.body, 1, 200) \
         FROM note n INNER JOIN note_entity ne ON ne.note_id = n.id \
         WHERE ne.user_id = $1 AND ne.entity_type = $2 AND ne.entity_id = $3 \
           AND n.archived_at IS NULL \
         ORDER BY n.updated_at DESC",
    )
    .bind(&user_id)
    .bind(&q.entity_type)
    .bind(&q.entity_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    let backlinks = rows
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            NoteBacklink {
                note_id: row.get(0),
                note_title: row.get(1),
                snippet: row.get(2),
            }
        })
        .collect();
    Ok(Json(backlinks))
}

pub async fn list_entity_links(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<NoteEntityLink>>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let rows = sqlx::query(
        "SELECT entity_type, entity_id \
         FROM note_entity WHERE note_id = $1 AND user_id = $2 \
         ORDER BY entity_type, entity_id",
    )
    .bind(&id)
    .bind(&user_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    let links = rows
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            NoteEntityLink {
                entity_type: row.get(0),
                entity_id: row.get(1),
            }
        })
        .collect();
    Ok(Json(links))
}