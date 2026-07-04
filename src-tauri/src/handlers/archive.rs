use axum::{
    extract::{Json, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Deserialize)]
pub struct ArchiveSummaryParams {
    pub user_id: String,
}

#[derive(Serialize)]
pub struct ArchiveSummary {
    pub action_count: i64,
    pub event_count: i64,
    pub project_count: i64,
    pub action_30d: i64,
    pub event_30d: i64,
    pub project_30d: i64,
}

pub async fn archive_summary(
    State(s): State<AppState>,
    Query(p): Query<ArchiveSummaryParams>,
) -> Result<Json<ArchiveSummary>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let summary = compute_summary(&conn, &p.user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(summary))
}

#[derive(Deserialize)]
pub struct BulkUnarchiveBody {
    pub user_id: String,
    pub entity: String,
}

#[derive(Serialize)]
pub struct BulkUnarchiveResult {
    pub unarchived: usize,
}

pub async fn bulk_unarchive(
    State(s): State<AppState>,
    Json(body): Json<BulkUnarchiveBody>,
) -> Result<Json<BulkUnarchiveResult>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let cutoff = (Utc::now() - Duration::days(30))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let n = match body.entity.as_str() {
        "action" => conn
            .execute(
                "UPDATE Action SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE ownerId = ?2 AND archivedAt IS NOT NULL AND archivedAt >= ?3",
                rusqlite::params![&cutoff, &body.user_id, &cutoff],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "event" => conn
            .execute(
                "UPDATE Event SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE ownerId = ?2 AND archivedAt IS NOT NULL AND archivedAt >= ?3",
                rusqlite::params![&cutoff, &body.user_id, &cutoff],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "project" => conn
            .execute(
                "UPDATE \"Project\" SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE ownerId = ?2 AND archivedAt IS NOT NULL AND archivedAt >= ?3",
                rusqlite::params![&cutoff, &body.user_id, &cutoff],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };
    Ok(Json(BulkUnarchiveResult { unarchived: n }))
}

#[derive(Deserialize)]
pub struct UnarchiveOneBody {
    pub user_id: String,
    pub entity: String,
    pub id: String,
}

pub async fn unarchive_one(
    State(s): State<AppState>,
    Json(body): Json<UnarchiveOneBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let n = match body.entity.as_str() {
        "action" => conn
            .execute(
                "UPDATE Action SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE id = ?2 AND ownerId = ?3",
                rusqlite::params![&now, &body.id, &body.user_id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "event" => conn
            .execute(
                "UPDATE Event SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE id = ?2 AND ownerId = ?3",
                rusqlite::params![&now, &body.id, &body.user_id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        "project" => conn
            .execute(
                "UPDATE \"Project\" SET archivedAt = NULL, updatedAt = ?1 \
                 WHERE id = ?2 AND ownerId = ?3",
                rusqlite::params![&now, &body.id, &body.user_id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };
    if n == 0 {
        return Err((StatusCode::NOT_FOUND, "item not found".to_string()));
    }
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ArchiveListParams {
    pub user_id: String,
    pub entity: String,
    pub limit: Option<i64>,
}

pub async fn archive_list(
    State(s): State<AppState>,
    Query(p): Query<ArchiveListParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let limit = p.limit.unwrap_or(500);
    let sql = match p.entity.as_str() {
        "action" => format!(
            "SELECT id, title, archivedAt FROM Action \
             WHERE ownerId = ?1 AND archivedAt IS NOT NULL \
             ORDER BY archivedAt DESC LIMIT {limit}"
        ),
        "event" => format!(
            "SELECT id, title, archivedAt FROM Event \
             WHERE ownerId = ?1 AND archivedAt IS NOT NULL \
             ORDER BY archivedAt DESC LIMIT {limit}"
        ),
        "project" => format!(
            "SELECT id, title, archivedAt FROM \"Project\" \
             WHERE ownerId = ?1 AND archivedAt IS NOT NULL \
             ORDER BY archivedAt DESC LIMIT {limit}"
        ),
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("unknown entity: {other}"),
            ))
        }
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rows: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![&p.user_id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "archived_at": r.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Json(serde_json::Value::Array(rows)))
}

#[derive(Deserialize)]
pub struct ArchiveCountParams {
    pub user_id: String,
}

#[derive(Serialize)]
pub struct ArchiveCounts {
    pub action: i64,
    pub event: i64,
    pub project: i64,
}

pub async fn archive_counts(
    State(s): State<AppState>,
    Query(p): Query<ArchiveCountParams>,
) -> Result<Json<ArchiveCounts>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let action: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Action WHERE ownerId = ?1 AND archivedAt IS NOT NULL",
            rusqlite::params![&p.user_id],
            |r| r.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let event: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Event WHERE ownerId = ?1 AND archivedAt IS NOT NULL",
            rusqlite::params![&p.user_id],
            |r| r.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let project: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Project\" WHERE ownerId = ?1 AND archivedAt IS NOT NULL",
            rusqlite::params![&p.user_id],
            |r| r.get(0),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ArchiveCounts {
        action,
        event,
        project,
    }))
}

fn compute_summary(conn: &Connection, user_id: &str) -> rusqlite::Result<ArchiveSummary> {
    let cutoff = (Utc::now() - Duration::days(30))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    Ok(ArchiveSummary {
        action_count: count(conn, "Action", user_id, None)?,
        event_count: count(conn, "Event", user_id, None)?,
        project_count: count(conn, "Project", user_id, None)?,
        action_30d: count(conn, "Action", user_id, Some(&cutoff))?,
        event_30d: count(conn, "Event", user_id, Some(&cutoff))?,
        project_30d: count(conn, "Project", user_id, Some(&cutoff))?,
    })
}

fn count(
    conn: &Connection,
    table: &str,
    user_id: &str,
    since: Option<&str>,
) -> rusqlite::Result<i64> {
    let quoted = match table {
        "Project" => "\"Project\"".to_string(),
        _ => table.to_string(),
    };
    let sql = match since {
        Some(_) => format!(
            "SELECT COUNT(*) FROM {quoted} \
             WHERE ownerId = ?1 AND archivedAt IS NOT NULL AND archivedAt >= ?2"
        ),
        None => format!(
            "SELECT COUNT(*) FROM {quoted} \
             WHERE ownerId = ?1 AND archivedAt IS NOT NULL"
        ),
    };
    if since.is_some() {
        conn.query_row(&sql, rusqlite::params![user_id, since.unwrap()], |r| r.get(0))
    } else {
        conn.query_row(&sql, rusqlite::params![user_id], |r| r.get(0))
    }
}

#[allow(dead_code)]
fn _signature_check(_t: DateTime<Utc>) {}
