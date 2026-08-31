use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::cmp::Ordering;
use std::sync::Arc;

use super::auth::extract_auth;
use super::now_str;

// `note` participates in LWW via `updated_at` (matches the client's
// `UPDATED_AT_TABLES` in src-tauri/src/sync/translate.rs). `note_entity` is a
// junction row (push-all, no updated_at) so it is deliberately absent here.
const UPDATED_AT_TABLES: &[&str] = &["contact", "project", "event", "action", "setting", "media", "note"];

/// Postgres errors that should become 200 + `conflicts` instead of 500.
fn is_data_conflict_error(msg: &str) -> bool {
    msg.contains("unique constraint")
        || msg.contains("duplicate key")
        || msg.contains("foreign key")
        || msg.contains("violates")
}

/// Convert the server's stored `updated_at` text into the ISO 8601 shape the
/// client uses, so lexicographic LWW comparison matches chronological order.
///
/// Server storage varies by table (TEXT for 6 tables, TIMESTAMPTZ for note),
/// and both PG stringifications use a space separator + no milliseconds:
/// `"2026-08-24 10:00:00+00"`. The client always sends RFC3339 with a `T`
/// separator and 3-digit milliseconds: `"2026-08-24T10:00:00.000Z"`. Without
/// normalization, byte `'T'` (0x54) > `' '` (0x20) makes the client always
/// win regardless of chronology. We try several and fall back to the raw
/// string if none parse — the cmp() still gives a deterministic, if
/// format-mixed, order rather than panicking.
fn normalize_lww_timestamp(raw: &str) -> String {
    // Forms to try, in order of how each table type serializes:
    //  1. PG TIMESTAMPTZ default: "2026-08-24 10:00:00+00"
    //  2. PG TIMESTAMPTZ with sub-second: "2026-08-24 10:00:00.123456+00"
    //  3. PG TEXT (manually inserted) ISO with offset: "2026-08-24T10:00:00+00:00"
    //  4. RFC3339 (client normal form): "2026-08-24T10:00:00.000Z"
    let candidates = [
        DateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.f%z"),
        DateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%z"),
        DateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f%z"),
        DateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%z"),
        DateTime::parse_from_rfc3339(raw),
    ];
    if let Some(c) = candidates.into_iter().flatten().next() {
        return c.with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    }
    raw.to_string()
}

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
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let user_uuid_for_log_only: String = user_id.clone();

    let row = sqlx::query_as::<_, (i32, i64, Option<String>)>(
        "SELECT schema_version, server_revision, last_updated FROM sync_manifest WHERE user_id = $1",
    )
    .bind(&user_id)
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
    .bind(&user_id)
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
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let user_uuid_for_log_only: String = user_id.clone();
    let device_uuid_for_log_only: String = req.device_id.clone();

    let device = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT revoked_at FROM devices WHERE id = $1 AND user_id = $2",
    )
    .bind(&req.device_id)
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("device: {e}")))?
    .ok_or((StatusCode::UNAUTHORIZED, "device not found".to_string()))?;

    if device.0.is_some() {
        return Err((StatusCode::UNAUTHORIZED, "device revoked".to_string()));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tx: {e}")))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&req.device_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("set_config: {e}")))?;

    let mut accepted = Vec::new();
    let mut conflicts = Vec::new();
    let mut sp_id: u32 = 0;

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
            "entity_link" => "entity_links",
            "media" => "media",
            // §11.7 notes. The client pushes these kinds (see
            // src-tauri/src/sync/translate.rs ENTITY_KINDS); omitting them here
            // made every note upload fail with "unknown entity kind".
            "note" => "note",
            "note_entity" => "note_entity",
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

            let sp_name = format!("sp_{sp_id}");
            sp_id += 1;

            sqlx::query(&format!("SAVEPOINT {sp_name}"))
                .execute(&mut *tx)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("savepoint: {e}"),
                    )
                })?;

            let mut cmp_result: Option<Ordering> = None;
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
                .bind(&user_id)
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
                    Some((Some(existing_ua),)) => {
                        let existing_norm = normalize_lww_timestamp(&existing_ua);
                        let ord = updated_at.cmp(&existing_norm);
                        cmp_result = Some(ord);
                        ord == Ordering::Greater
                    }
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

                let op_result = if let Some(da) = deleted_at {
                    let set_clause = if has_updated_at {
                        "deleted_at = $3, updated_at = $3"
                    } else {
                        "deleted_at = $3"
                    };
                    sqlx::query(&format!(
                        "UPDATE {} SET {} WHERE id = $1 AND user_id = $2",
                        table, set_clause
                    ))
                    .bind(&row_id)
                    .bind(&user_id)
                    .bind(da)
                    .execute(&mut *tx)
                    .await
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
                    let mut update_clauses: Vec<String> = keys
                        .iter()
                        .map(|k| format!("{k} = EXCLUDED.{k}"))
                        .collect();
                    if table == "reminder" {
                        for k in &["dispatched", "dismissed"] {
                            if let Some(pos) = update_clauses.iter().position(|c| c.starts_with(&format!("{k} ="))) {
                                update_clauses[pos] = format!("{k} = reminder.{k} OR EXCLUDED.{k}");
                            }
                        }
                    }
                    let update_set = update_clauses.join(", ");

                    let sql = format!(
                        "INSERT INTO {} SELECT * FROM jsonb_populate_record(NULL::{}, $1::jsonb) \
                         ON CONFLICT (id) DO UPDATE SET {}",
                        table, table, update_set
                    );

                    sqlx::query(&sql)
                        .bind(&row_str)
                        .execute(&mut *tx)
                        .await
                };

                match op_result {
                    Ok(_) => {
                        sqlx::query(&format!("RELEASE SAVEPOINT {sp_name}"))
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| {
                                (
                                    StatusCode::INTERNAL_SERVER_ERROR,
                                    format!("release sp: {e}"),
                                )
                            })?;
                        accepted.push(format!("{}:{}", entity.kind, row_id));
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let is_data_conflict = is_data_conflict_error(&msg);
                        sqlx::query(&format!("ROLLBACK TO SAVEPOINT {sp_name}"))
                            .execute(&mut *tx)
                            .await
                            .ok();
                        if is_data_conflict {
                            conflicts.push(Conflict {
                                kind: entity.kind.clone(),
                                row_id: row_id.clone(),
                                reason: msg,
                            });
                        } else {
                            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("upsert: {e}")));
                        }
                    }
                }
            } else {
                sqlx::query(&format!("RELEASE SAVEPOINT {sp_name}"))
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("release sp: {e}"),
                        )
                    })?;
                if cmp_result == Some(Ordering::Less) {
                    conflicts.push(Conflict {
                        kind: entity.kind.clone(),
                        row_id: row_id.clone(),
                        reason: "server has newer updated_at".to_string(),
                    });
                }
            }
        }
    }

    tx.commit().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("commit: {e}"),
        )
    })?;

    let server_revision: i64 =
        sqlx::query_scalar("SELECT server_revision FROM sync_manifest WHERE user_id = $1")
            .bind(&user_id)
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
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let user_uuid_for_log_only: String = user_id.clone();
    let limit = req.limit.unwrap_or(500).min(1000);

    let rows = sqlx::query_as::<_, (String, String, String, Option<Value>, i64)>(
        "SELECT table_name, op, row_id, data, server_revision
         FROM sync_change_log
         WHERE user_id = $1 AND server_revision > $2
         ORDER BY server_revision ASC
         LIMIT $3",
    )
    .bind(&user_id)
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
    .bind(&user_id)
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

pub async fn prune_change_log(pool: &PgPool, ttl_days: i64) -> Result<u64, sqlx::Error> {
    // `make_interval` only takes `integer`, but sqlx binds `i64` → bigint, so we
    // cast explicitly. PG 16 has no overload for bigint days.
    let result = sqlx::query(
        "DELETE FROM sync_change_log \
         WHERE changed_at < to_char(NOW() AT TIME ZONE 'UTC' - make_interval(days => $1::int), 'YYYY-MM-DD HH24:MI:SS')"
    )
    .bind(ttl_days)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
