use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::{extract_auth, extract_auth_with_device};
use super::now_str;
use weavine_lib::models::{Note, NoteBacklink, NoteEntityLink};

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

fn parse_note_cursor(cursor: &str) -> Option<(String, String)> {
    let mut parts = cursor.splitn(2, ',');
    let updated_at = parts.next()?.to_string();
    let id = parts.next()?;
    if updated_at.is_empty() || id.is_empty() {
        return None;
    }
    Some((updated_at, id.to_string()))
}

fn validate_entity_links(links: &[NoteEntityLink]) -> Result<(), (StatusCode, String)> {
    for link in links {
        match link.entity_type.as_str() {
            "contact" | "project" | "event" | "action" | "interaction" => {}
            other => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    format!("不支持的关联实体类型: {other}"),
                ))
            }
        }
    }
    Ok(())
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
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let limit = q.limit.unwrap_or(30).clamp(1, 200) + 1;
    let (cursor_updated_at, cursor_id) = q.cursor.as_deref().and_then(parse_note_cursor).unzip();
    let sql = "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
               FROM note WHERE user_id = $1 AND archived_at IS NULL AND deleted_at IS NULL \
               AND ($2::text IS NULL OR updated_at < $2 \
                    OR (updated_at = $2 AND id > $3)) \
               ORDER BY updated_at DESC, id ASC \
               LIMIT $4";
    let rows = sqlx::query_as::<_, Note>(sql)
        .bind(&user_id)
        .bind(&cursor_updated_at)
        .bind(&cursor_id)
        .bind(limit)
        .fetch_all(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    let has_more = rows.len() > limit as usize - 1;
    let rows: Vec<Note> = rows.into_iter().take(limit as usize - 1).collect();
    let last_item = rows.last().map(|n| format!("{},{}", n.updated_at, n.id));
    Ok(Json(serde_json::json!({
        "items": rows,
        "cursor": last_item,
        "has_more": has_more,
    })))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let note = sqlx::query_as::<_, Note>(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE id = $1 AND user_id = $2 AND archived_at IS NULL AND deleted_at IS NULL",
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
    Json(body): Json<Value>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let (user_id, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "缺少 title".into()))?
        .to_string();
    let note_body = body
        .get("body")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_REQUEST, "缺少 body".into()))?
        .to_string();
    let entity_links: Vec<NoteEntityLink> = body
        .get("entity_links")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    validate_entity_links(&entity_links)?;
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
    .bind(&title)
    .bind(&note_body)
    .bind(&now_str)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert: {e}")))?;

    for link in &entity_links {
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
    Json(body): Json<Value>,
) -> Result<Json<Note>, (StatusCode, String)> {
    let (user_id, _device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let now: DateTime<Utc> = Utc::now();
    let now_str = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tx: {e}")))?;

    let new_title = body.get("title").and_then(|v| v.as_str());
    let new_body = body.get("body").and_then(|v| v.as_str());
    let res = sqlx::query(
        "UPDATE note SET \
            title      = COALESCE($3, title), \
            body       = COALESCE($4, body),  \
            updated_at = $5 \
          WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&user_id)
    .bind(new_title)
    .bind(new_body)
    .bind(&now_str)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("update: {e}")))?;
    if res.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "note not found".into()));
    }

    if let Some(arr) = body.get("entity_links").and_then(|v| v.as_array()) {
        let links: Vec<NoteEntityLink> = arr
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect();
        validate_entity_links(&links)?;
        sqlx::query("DELETE FROM note_entity WHERE note_id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("unlink: {e}")))?;
        for link in &links {
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
    let now = now_str();
    let res = sqlx::query(
        "UPDATE note SET deleted_at = $3, updated_at = $3 \
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(&id)
    .bind(&user_id)
    .bind(&now)
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
        "SELECT n.id, n.title, substr(n.body, 1, 200), n.updated_at \
         FROM note n INNER JOIN note_entity ne ON ne.note_id = n.id \
         WHERE ne.user_id = $1 AND ne.entity_type = $2 AND ne.entity_id = $3 \
           AND n.archived_at IS NULL AND n.deleted_at IS NULL \
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
                updated_at: row.get(3),
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