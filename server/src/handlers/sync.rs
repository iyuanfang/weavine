use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::extract_auth;
use super::now_str;

const UPDATED_AT_TABLES: &[&str] = &["contact", "project", "event", "action", "setting"];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ManifestResp {
    pub schema_version: i32,
    pub server_revision: i64,
    pub last_updated: Option<String>,
}

pub async fn manifest(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
) -> Result<Json<ManifestResp>, (StatusCode, String)> {
    let user_id = extract_auth(&headers)?;
    let user_uuid = uuid::Uuid::parse_str(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("user_id parse: {e}")))?;

    let row = sqlx::query_as::<_, (i32, i64, Option<String>)>(
        "SELECT schema_version, server_revision, last_updated FROM sync_manifest WHERE user_id = $1",
    )
    .bind(user_uuid)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;

    if let Some((schema_version, server_revision, last_updated)) = row {
        return Ok(Json(ManifestResp {
            schema_version,
            server_revision,
            last_updated,
        }));
    }

    let now = now_str();
    sqlx::query(
        "INSERT INTO sync_manifest (user_id, schema_version, server_revision, last_updated) \
         VALUES ($1, 1, 0, $2)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(user_uuid)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert: {e}")))?;

    Ok(Json(ManifestResp {
        schema_version: 1,
        server_revision: 0,
        last_updated: Some(now),
    }))
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PushReq {
    pub device_id: String,
    pub entities: Vec<EntityPush>,
}

#[derive(Deserialize)]
pub struct EntityPush {
    pub kind: String,
    pub rows: Vec<Value>,
}

#[derive(Serialize)]
pub struct PushResp {
    pub accepted: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub server_revision: i64,
}

#[derive(Serialize)]
pub struct Conflict {
    pub kind: String,
    pub row_id: String,
    pub reason: String,
}

pub async fn push(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(req): Json<PushReq>,
) -> Result<Json<PushResp>, (StatusCode, String)> {
    let user_id = extract_auth(&headers)?;
    let user_uuid = uuid::Uuid::parse_str(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("user_id: {e}")))?;
    let device_uuid = uuid::Uuid::parse_str(&req.device_id)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("device_id: {e}")))?;

    let device = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT revoked_at FROM devices WHERE id = $1 AND user_id = $2",
    )
    .bind(device_uuid)
    .bind(user_uuid)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("device: {e}")))?
    .ok_or((StatusCode::UNAUTHORIZED, "device not found".to_string()))?;

    if device.0.is_some() {
        return Err((StatusCode::UNAUTHORIZED, "device revoked".to_string()));
    }

    let mut accepted = Vec::new();
    let mut conflicts = Vec::new();

    for entity in req.entities {
        let table = match entity.kind.as_str() {
            "contact" => "contact",
            "tag" => "tag",
            "project" => "project",
            "event" => "event",
            "action" => "action",
            "interaction" => "interaction",
            "reminder" => "reminder",
            "setting" => "setting",
            "contact_tag" => "contact_tag",
            "project_contact" => "project_contact",
            _ => {
                conflicts.push(Conflict {
                    kind: entity.kind.clone(),
                    row_id: String::new(),
                    reason: "unknown entity kind".to_string(),
                });
                continue;
            }
        };
        let has_updated_at = UPDATED_AT_TABLES.contains(&table);

        for row_json in entity.rows {
            let row_id = match row_json.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => {
                    conflicts.push(Conflict {
                        kind: entity.kind.clone(),
                        row_id: String::new(),
                        reason: "missing id".to_string(),
                    });
                    continue;
                }
            };
            let row_user_id = row_json.get("user_id").and_then(|v| v.as_str());
            if row_user_id != Some(&user_id) {
                conflicts.push(Conflict {
                    kind: entity.kind.clone(),
                    row_id: row_id.clone(),
                    reason: "user_id mismatch".to_string(),
                });
                continue;
            }

            let mut tx = pool
                .begin()
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tx: {e}")))?;

            sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
                .bind(device_uuid.to_string())
                .execute(&mut *tx)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("set_config: {e}")))?;

            let should_upsert = if has_updated_at {
                let updated_at = row_json
                    .get("updated_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let existing: Option<(Option<String>,)> = sqlx::query_as(&format!(
                    "SELECT updated_at FROM {} WHERE id = $1 AND user_id = $2",
                    table
                ))
                .bind(&row_id)
                .bind(user_uuid)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("select existing: {e}"),
                    )
                })?;

                match existing {
                    None => true,
                    Some((Some(existing_ua),)) => updated_at >= existing_ua.as_str(),
                    _ => true,
                }
            } else {
                true
            };

            if should_upsert {
                let deleted_at = row_json
                    .get("deleted_at")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());

                if deleted_at.is_some() {
                    sqlx::query(&format!(
                        "DELETE FROM {} WHERE id = $1 AND user_id = $2",
                        table
                    ))
                    .bind(&row_id)
                    .bind(user_uuid)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("delete: {e}"),
                        )
                    })?;
                    tx.commit()
                        .await
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("commit: {e}")))?;
                    accepted.push(format!("{}:{}", entity.kind, row_id));
                } else {
                    let row_str = serde_json::to_string(&row_json)
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;

                    let keys: Vec<String> = row_json
                        .as_object()
                        .map(|obj| {
                            obj.keys()
                                .filter(|k| *k != "id" && *k != "user_id")
                                .cloned()
                                .collect()
                        })
                        .unwrap_or_default();
                    let update_set = keys
                        .iter()
                        .map(|k| format!("{k} = EXCLUDED.{k}"))
                        .collect::<Vec<_>>()
                        .join(", ");

                    let sql = format!(
                        "INSERT INTO {} SELECT * FROM jsonb_populate_record(NULL::{}, $1::jsonb) \
                         ON CONFLICT (id) DO UPDATE SET {}",
                        table, table, update_set
                    );

                    sqlx::query(&sql)
                        .bind(&row_str)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| {
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                format!("upsert: {e}"),
                            )
                        })?;

                    tx.commit()
                        .await
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("commit: {e}")))?;
                    accepted.push(format!("{}:{}", entity.kind, row_id));
                }
            } else {
                tx.rollback().await.ok();
                conflicts.push(Conflict {
                    kind: entity.kind.clone(),
                    row_id: row_id.clone(),
                    reason: "server has newer updated_at".to_string(),
                });
            }
        }
    }

    let server_revision: i64 =
        sqlx::query_scalar("SELECT server_revision FROM sync_manifest WHERE user_id = $1")
            .bind(user_uuid)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rev query: {e}")))?
            .unwrap_or(0);

    Ok(Json(PushResp {
        accepted,
        conflicts,
        server_revision,
    }))
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct PullReq {
    pub since_revision: i64,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct ChangeRow {
    pub kind: String,
    pub op: String,
    pub row_id: String,
    pub data: Option<Value>,
    pub revision: i64,
}

#[derive(Serialize)]
pub struct PullResp {
    pub rows: Vec<ChangeRow>,
    pub latest_revision: i64,
    pub has_more: bool,
}

pub async fn pull(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(req): Json<PullReq>,
) -> Result<Json<PullResp>, (StatusCode, String)> {
    let user_id = extract_auth(&headers)?;
    let user_uuid = uuid::Uuid::parse_str(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("user_id: {e}")))?;
    let limit = req.limit.unwrap_or(500).min(1000);

    let rows = sqlx::query_as::<_, (String, String, String, Option<Value>, i64)>(
        "SELECT table_name, op, row_id, data, server_revision
         FROM sync_change_log
         WHERE user_id = $1 AND server_revision > $2
         ORDER BY server_revision ASC
         LIMIT $3",
    )
    .bind(user_uuid)
    .bind(req.since_revision)
    .bind(limit + 1)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;

    let has_more = rows.len() as i64 > limit;
    let rows: Vec<_> = rows.into_iter().take(limit as usize).collect();

    let latest_revision = rows
        .last()
        .map(|r| r.4)
        .unwrap_or(req.since_revision);

    let now = now_str();
    sqlx::query(
        "INSERT INTO sync_meta (user_id, last_pulled_revision, last_sync_at) \
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE \
         SET last_pulled_revision = EXCLUDED.last_pulled_revision, \
             last_sync_at = EXCLUDED.last_sync_at",
    )
    .bind(user_uuid)
    .bind(latest_revision)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("meta: {e}")))?;

    let change_rows: Vec<ChangeRow> = rows
        .into_iter()
        .map(|(table_name, op, row_id, data, revision)| ChangeRow {
            kind: table_name,
            op,
            row_id,
            data,
            revision,
        })
        .collect();

    Ok(Json(PullResp {
        rows: change_rows,
        latest_revision,
        has_more,
    }))
}
