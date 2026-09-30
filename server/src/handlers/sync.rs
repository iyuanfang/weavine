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

// Must stay identical to the client's `UPDATED_AT_TABLES`
// (src-tauri/src/sync/translate.rs) — membership here is what makes the push
// handler run an LWW comparison instead of blindly upserting.
//
// `tag`, `interaction` and `reminder` joined on 2026-09-26 (migration
// 20260926000003) so that clients stop re-uploading them in full every cycle.
// The four junction kinds are deliberately absent: they have no `updated_at`
// column, and an `updated_at` watermark could not express their deletes anyway —
// a deleted junction row simply stops being selected, so its removal has no row
// to travel in.
const UPDATED_AT_TABLES: &[&str] =
    &["contact", "project", "event", "action", "setting", "media", "note",
      "tag", "interaction", "reminder"];

const DELETED_AT_TABLES: &[&str] =
    &["contact", "tag", "project", "event", "action", "interaction",
      "reminder", "setting", "media", "note"];

/// One entry per synced entity kind — the single source of truth shared by
/// `push` (kind → table lookup) and `snapshot` (bootstrap pagination).
///
/// Order is FK-parent-first: a device that bootstraps applies the pages in this
/// order, and with `PRAGMA foreign_keys=ON` a child row inserted before its
/// parent fails the constraint. It matches the client's `ENTITY_KINDS`
/// (src-tauri/src/sync/translate.rs) — `sync_tables_cover_every_client_kind`
/// pins that down.
///
/// Every table listed here has a unique `id`. The two junction tables are the
/// subtle ones: `contact_tag` / `project_contact` started out with composite
/// primary keys, and migration 20260705000002 gave them an `id` precisely
/// because `sync_log_change()` reads `NEW.id`. That lets snapshot pagination
/// be one keyset query shape (`WHERE id > cursor ORDER BY id`) for every kind,
/// which is stable while rows are being inserted — unlike OFFSET.
///
/// Previously this mapping was an inline `match` inside `push`, which is how
/// `note` / `note_entity` came to be missing from it while the client kept
/// pushing them — every note upload failed with "unknown entity kind".
const SYNC_TABLES: &[(&str, &str)] = &[
    // level 0 — FK only to user_account
    ("contact", "contact"),
    ("tag", "tag"),
    ("project", "project"),
    ("setting", "setting"),
    ("note", "note"),
    // level 1 — → project / contact
    ("event", "event"),
    ("action", "action"),
    // level 2 — → contact / project / action / event
    ("interaction", "interaction"),
    ("reminder", "reminder"),
    // level 3 — junction rows over already-synced entities
    ("contact_tag", "contact_tag"),
    ("project_contact", "project_contact"),
    ("media", "media"),
    // level 3.5 — polymorphic links, no FK
    ("entity_link", "entity_links"),
    ("note_entity", "note_entity"),
];

fn table_for_kind(kind: &str) -> Option<&'static str> {
    SYNC_TABLES
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, t)| *t)
}

/// Tables carrying `archived_at`, skipped by the initial snapshot.
///
/// An archived row is history a *new* device does not need, and it is a large
/// part of what made the replayed backlog so big. Nothing is lost: archived
/// rows still travel on the incremental stream, and a device that already has
/// one keeps it (the snapshot never deletes local rows). Archived rows are also
/// swept out entirely once they age past the retention window — see
/// `handlers::archive_purge`.
///
/// `contact` joined on 2026-09-26, one step behind `PURGEABLE_TABLES`. Excluding
/// an archived contact here matches what the retention sweep is about to do with
/// it: a contact archived for the whole window is hard-deleted, so shipping it
/// to a brand-new device only to delete it again a few syncs later is pure
/// waste — and it is the `contact → contact_tag / project_contact / reminder`
/// cascade that makes it expensive, not the single row.
///
/// ⚠️ Note for whoever picks this up next: nothing currently *writes*
/// `contact.archived_at` — not `handlers::contact.rs`, not the web SPA, not the
/// desktop. The column, this filter and `PURGEABLE_TABLES` are all in place, but
/// the feature they serve has no entry point yet, so contact retention is inert
/// (see the spec's §18.3). The filter is still correct for the day one appears.
const ARCHIVED_AT_TABLES: &[&str] = &["event", "action", "project", "note", "contact"];

/// Kinds the client can store a tombstone for — exactly the 8 tables that have
/// a local `deleted_at` column (see `soft_delete_alts` in
/// src-tauri/src/migration.rs). These are the only kinds whose snapshot
/// includes soft-deleted rows.
///
/// Why ship tombstones at all: a device that bootstraps is usually one that was
/// away long enough for its needed revisions to be pruned out of the changelog,
/// which means deletions from that window are gone from the log too. Without
/// the tombstones the device would keep showing rows the server no longer has.
///
/// For any other kind a tombstone row would be worse than useless: the client
/// has nowhere to record it, so `apply_change` would insert it as a *live* row
/// (or resurrect a junction row). For those, absence from the snapshot already
/// means "deleted".
const TOMBSTONE_KINDS: &[&str] = &[
    "contact", "tag", "project", "event", "action", "interaction", "reminder", "note",
];

/// Guard for column names interpolated into the upsert's `SET` clause.
///
/// Those names come verbatim from client-supplied JSON keys. A key such as
/// `title = (SELECT email FROM user_account WHERE id='...') , body` would be
/// spliced straight into the statement and let any authenticated caller read
/// or modify rows they do not own. Only plain snake_case identifiers may pass.
///
/// (`jsonb_populate_record` needs no such guard: unknown keys are ignored.)
fn is_safe_column_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 63 // PG NAMEDATALEN - 1
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c == '_')
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Postgres errors that should become 200 + `conflicts` instead of 500.
///
fn is_data_conflict_error(msg: &str) -> bool {
    msg.contains("unique constraint")
        || msg.contains("duplicate key")
        || msg.contains("foreign key")
        || msg.contains("violates")
        || msg.contains("invalid input syntax")
        || msg.contains("not-null")
        || msg.contains("check constraint")
        || msg.contains("value too long")
        || msg.contains("datetime")
        || msg.contains("timestamp")
        || msg.contains("out of range")
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

/// The highest change-log revision this user has.
///
/// Deliberately not `sync_manifest.server_revision`: nothing has ever written
/// that column after the initial `INSERT … VALUES (…, 0, …)`, so it reads 0
/// forever and would make a snapshot cursor worthless.
///
/// The `GREATEST` floor matters after pruning: once rows are dropped, the
/// highest *surviving* revision can sit below revisions we already removed, and
/// handing a client a cursor below `pruned_through_revision` would make it
/// bootstrap from the snapshot again on every cycle — forever.
async fn current_revision(pool: &PgPool, user_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT GREATEST( \
             COALESCE((SELECT MAX(server_revision) FROM sync_change_log WHERE user_id = $1), 0), \
             COALESCE((SELECT pruned_through_revision FROM sync_meta WHERE user_id = $1), 0) \
         )",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
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

    // `schema_version`/`last_updated` live in `sync_manifest`, but its
    // `server_revision` column is vestigial (never updated after the initial
    // insert) — report the real change-log head instead.
    let live_revision = current_revision(pool.as_ref(), &user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("revision: {e}")))?;

    if let Some((schema_version, _stale_revision, last_updated)) = row {
        return Ok(Json(ManifestResp {
            schema_version,
            server_revision: live_revision,
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
        server_revision: live_revision,
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
        // Whitelist lookup — see SYNC_TABLES. Keeping one table list means the
        // push path and the snapshot path can never disagree about which kinds
        // exist (that drift is what silently dropped every note upload once).
        let table = match table_for_kind(entity.kind.as_str()) {
            Some(t) => t,
            None => {
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

            // A row whose payload carries no `updated_at` cannot take part in
            // LWW. That is the case for two groups of clients: the four
            // junction kinds (no such column at all), and *every client built
            // before migration 20260926000003*.
            //
            // Those rows are accepted outright, and whatever the server already
            // holds is left alone — the SET clause below is built from the
            // payload's own keys, so a missing `updated_at` simply is not
            // written. The trap to avoid is defaulting to the empty string:
            // `"" < <any real timestamp>`, so every tag / interaction /
            // reminder write from an un-upgraded client would be rejected and
            // that device would silently stop syncing those three kinds.
            let incoming_updated_at = row_json
                .get("updated_at")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());

            let mut cmp_result: Option<Ordering> = None;
            let should_upsert = match (has_updated_at, incoming_updated_at) {
                (true, Some(incoming)) => {
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
                        // Row is new to the server.
                        None => true,
                        // Row exists but carries no version yet: last written
                        // before the column existed, or by a client that did not
                        // send one. Nothing to compare against, so accept.
                        Some((None,)) => true,
                        Some((Some(existing_ua),)) => {
                            let existing_norm = normalize_lww_timestamp(&existing_ua);
                            let ord = incoming.cmp(&existing_norm);
                            cmp_result = Some(ord);
                            // `Greater` only. `Equal` (both sides hold the
                            // client's backfill sentinel) is deliberately a
                            // no-op rather than a win, so two devices upgrading
                            // at different times do not fight over rows neither
                            // has actually edited.
                            ord == Ordering::Greater
                        }
                    }
                }
                // Table keeps no LWW column, or payload carried no version.
                _ => true,
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
                                // Reject anything that is not a plain column
                                // name — see is_safe_column_name. Without this
                                // a crafted key injects arbitrary SQL into the
                                // SET clause built from these keys.
                                .filter(|k| is_safe_column_name(k.as_str()))
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
                    if DELETED_AT_TABLES.contains(&table) {
                        if let Some(pos) =
                            update_clauses.iter().position(|c| c.starts_with("deleted_at ="))
                        {
                            update_clauses[pos] = format!(
                                "deleted_at = COALESCE(EXCLUDED.deleted_at, {table}.deleted_at)"
                            );
                        }
                    }
                    let update_set = update_clauses.join(", ");

                    // Which key identifies this row?
                    //
                    // Normally `id`. The two composite-PK junction tables are
                    // different: their SQLite counterparts have no `id` column
                    // (see `translate.rs::add_junction_id`), so the client
                    // generates a **fresh UUID on every push**. With
                    // `ON CONFLICT (id)` that never matched the existing row, so
                    // every cycle re-INSERTed the pair until
                    // `uq_contact_tag_pair` / `uq_project_contact_pair` rejected
                    // it — which `is_data_conflict_error` then downgraded to a
                    // conflict. Every device therefore reported its whole
                    // tag/project-membership set as conflicting on every sync and
                    // the real conflicts were buried in the noise.
                    //
                    // Conflicting on the pair instead makes the repeat push a
                    // plain no-op update (the SET clause overwrites the pair with
                    // itself), and the change-log trigger's identity guard then
                    // declines to log it at all.
                    let conflict_target = match table {
                        "contact_tag" => "(contact_id, tag_id)",
                        "project_contact" => "(project_id, contact_id)",
                        _ => "(id)",
                    };
                    let sql = format!(
                        "INSERT INTO {} SELECT * FROM jsonb_populate_record(NULL::{}, $1::jsonb) \
                         ON CONFLICT {} DO UPDATE SET {}",
                        table, table, conflict_target, update_set
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
                        // `ROLLBACK TO` deliberately keeps the savepoint defined
                        // (that is what makes it reusable), so without this the
                        // transaction accumulates one live savepoint entry per
                        // rejected row — up to `PUSH_CHUNK_SIZE` of them for a
                        // request that conflicts on every row. `.ok()` because a
                        // failure here says nothing about the row we are about to
                        // report.
                        sqlx::query(&format!("RELEASE SAVEPOINT {sp_name}"))
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

    let server_revision: i64 = current_revision(pool.as_ref(), &user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rev query: {e}")))?;

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
    /// Device asking for changes. Rows logged *by this same device* are
    /// skipped, because the client already holds every one of them — it is the
    /// device that wrote them.
    ///
    /// This closes the echo loop that the no-op trigger guard only half-closed.
    /// `sync_once` pushes and then pulls in the same cycle, so without this the
    /// N rows a device just uploaded come straight back to it and are replayed
    /// through `apply_change` one by one. The trigger guard stops those rows
    /// from being logged *again* on the next cycle; it cannot stop the first
    /// copy from returning to its author.
    ///
    /// Two groups of rows must keep flowing regardless, which is why the
    /// condition is written the way it is:
    ///
    ///   * `device_id IS NULL` — rows written by scheduled server work
    ///     (`archive_purge`, which has no request context to set
    ///     `app.current_device_id` from) and rows predating the column. These
    ///     are *other* writers' changes as far as a client is concerned: a
    ///     retention delete MUST reach every device or clients keep resurrecting
    ///     the row.
    ///   * a null/absent `device_id` in the request — clients built before this
    ///     field existed. They fall back to the previous behaviour (pull
    ///     everything), so the two sides can be deployed in either order.
    #[serde(default)]
    pub device_id: Option<String>,
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
    /// Highest revision whose change-log rows have already been pruned away.
    ///
    /// When the caller's cursor (`since_revision`) is *below* this mark, the
    /// incremental stream has a hole in it and can never close the gap — the
    /// client must bootstrap from `GET /api/sync/snapshot` and then resume
    /// incrementally from the snapshot's revision. Without this signal a
    /// device that was offline longer than the log TTL comes back, pulls
    /// nothing for the gap, and silently loses every change in it.
    #[serde(default)]
    pub pruned_through_revision: i64,
}

/// Incremental change stream for one user, oldest revision first.
///
/// `$4` is the requesting device. Rows it authored are excluded — see
/// `PullReq::device_id` for why, and for why the `device_id IS NULL` half of
/// the condition has to stay. Named (rather than inlined) so a guard test can
/// assert nobody drops the clause or its bind: losing either silently restores
/// a full down-then-up round trip on every write, which is invisible except as
/// "sync feels slow again".
const PULL_SQL: &str = "
    SELECT table_name, op, row_id, data, server_revision
    FROM sync_change_log
    WHERE user_id = $1 AND server_revision > $2
      AND ($4::text IS NULL OR device_id IS NULL OR device_id <> $4)
    ORDER BY server_revision ASC
    LIMIT $3
";

pub async fn pull(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(req): Json<PullReq>,
) -> Result<Json<PullResp>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let user_uuid_for_log_only: String = user_id.clone();
    let limit = req.limit.unwrap_or(500).min(1000);

    let rows = sqlx::query_as::<_, (String, String, String, Option<Value>, i64)>(PULL_SQL)
        .bind(&user_id)
        .bind(req.since_revision)
        .bind(limit + 1)
        .bind(req.device_id.as_deref())
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

    // Read back after the upsert above so the row is guaranteed to exist.
    let pruned_through_revision: i64 = sqlx::query_scalar(
        "SELECT pruned_through_revision FROM sync_meta WHERE user_id = $1",
    )
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("prune mark: {e}")))?
    .unwrap_or(0);

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
        pruned_through_revision,
    }))
}

// ---------------------------------------------------------------------------
// Snapshot (first sync / recovery bootstrap)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SnapshotReq {
    /// One of `SYNC_TABLES[].kind`.
    pub kind: String,
    /// Opaque; echo back the previous response's `next_cursor`. Absent = start.
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct SnapshotResp {
    pub kind: String,
    pub rows: Vec<Value>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    /// The user's change-log head, sampled **before** the first row is read.
    /// The client stores this as its pull cursor, so anything written while the
    /// snapshot is in flight is re-delivered by the incremental pull that
    /// follows — the snapshot may duplicate a change, never miss one.
    pub server_revision: i64,
}

/// Current state of one entity kind, for a client that has no usable cursor.
///
/// Why this exists: the incremental stream is a changelog, so catching up from
/// revision 0 costs O(number of edits ever made) rather than O(number of rows).
/// Bootstrapping from the snapshot costs O(rows), which on real accounts is one
/// to two orders of magnitude less, and it is what makes a phone's first sync
/// (and the recovery path after a long offline period) fast.
///
/// Rows are returned in the same shape as change-log payloads (`to_jsonb` of
/// the full row), so the client applies them through the existing
/// `apply_change` path unchanged.
pub async fn snapshot(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(req): Json<SnapshotReq>,
) -> Result<Json<SnapshotResp>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let user_uuid_for_log_only: String = user_id.clone();

    let table = table_for_kind(&req.kind).ok_or((
        StatusCode::BAD_REQUEST,
        format!("unknown entity kind: {}", req.kind),
    ))?;
    let limit = req.limit.unwrap_or(500).clamp(1, 1000);

    // Sampled before any row is read — see `SnapshotResp::server_revision`.
    let server_revision: i64 = current_revision(pool.as_ref(), &user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rev: {e}")))?;

    // `r` is the inner table alias; the outer subquery is also `r` because
    // `to_jsonb(r)` needs a row reference to serialise.
    let row_filter = if TOMBSTONE_KINDS.contains(&table) {
        // Live rows (minus archived ones where the column exists) plus every
        // tombstone — see TOMBSTONE_KINDS.
        if ARCHIVED_AT_TABLES.contains(&table) {
            " AND (r.deleted_at IS NOT NULL OR r.archived_at IS NULL)"
        } else {
            ""
        }
    } else {
        " AND r.deleted_at IS NULL"
    };

    let fetched: Vec<(Value,)> = sqlx::query_as(&format!(
        "SELECT to_jsonb(r) FROM ( \
             SELECT * FROM {table} r \
             WHERE r.user_id = $1{row_filter} \
               AND ($2 = '' OR r.id > $2) \
             ORDER BY r.id \
             LIMIT $3 \
         ) r"
    ))
    .bind(&user_id)
    .bind(req.cursor.clone().unwrap_or_default())
    .bind(limit + 1)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("snapshot: {e}")))?;

    // One extra row answers `has_more` without a second COUNT round-trip.
    let has_more = fetched.len() as i64 > limit;
    let rows: Vec<Value> = fetched
        .into_iter()
        .take(limit as usize)
        .map(|r| r.0)
        .collect();
    let next_cursor = if has_more {
        rows.last()
            .and_then(|row| row.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    } else {
        None
    };

    Ok(Json(SnapshotResp {
        kind: req.kind,
        rows,
        next_cursor,
        has_more,
        server_revision,
    }))
}

/// Drop change-log rows older than `ttl_days`, remembering how far we pruned.
///
/// The bookkeeping half matters as much as the delete: pruning is what creates
/// holes in the incremental stream. `sync_meta.pruned_through_revision` is the
/// high-water mark of everything we removed, and `pull` hands it to clients so
/// one whose cursor predates it knows to bootstrap from the snapshot instead
/// of quietly receiving an incomplete stream.
pub async fn prune_change_log(pool: &PgPool, ttl_days: i64) -> Result<u64, sqlx::Error> {
    // `make_interval` only takes `integer`, but sqlx binds `i64` → bigint, so we
    // cast explicitly. PG 16 has no overload for bigint days.
    const CUTOFF: &str =
        "to_char(NOW() AT TIME ZONE 'UTC' - make_interval(days => $1::int), 'YYYY-MM-DD HH24:MI:SS')";

    // Mark first, delete second: the two statements run in their own implicit
    // transactions, so a crash in between over-marks (harmless — clients just
    // bootstrap from the snapshot) rather than under-marks (silent data loss).
    sqlx::query(&format!(
        "WITH victims AS ( \
             SELECT user_id, MAX(server_revision) AS max_rev \
             FROM sync_change_log WHERE changed_at < {CUTOFF} \
             GROUP BY user_id \
         ) \
         INSERT INTO sync_meta (user_id, pruned_through_revision) \
         SELECT user_id, max_rev FROM victims \
         ON CONFLICT (user_id) DO UPDATE \
         SET pruned_through_revision = GREATEST(sync_meta.pruned_through_revision, EXCLUDED.pruned_through_revision)"
    ))
    .bind(ttl_days)
    .execute(pool)
    .await?;

    let result = sqlx::query(&format!(
        "DELETE FROM sync_change_log WHERE changed_at < {CUTOFF}"
    ))
    .bind(ttl_days)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_data_conflict_error_catches_invalid_input_syntax() {
        let msg = "ERROR: invalid input syntax for type uuid: \"foo\"";
        assert!(is_data_conflict_error(msg));
    }

    #[test]
    fn is_data_conflict_error_catches_all_data_error_classes() {
        assert!(is_data_conflict_error("unique constraint violated"));
        assert!(is_data_conflict_error("duplicate key value"));
        assert!(is_data_conflict_error("foreign key constraint"));
        assert!(is_data_conflict_error("violates not-null"));
        assert!(is_data_conflict_error("check constraint"));
        assert!(is_data_conflict_error("value too long for type character varying"));
        assert!(is_data_conflict_error("timestamp out of range"));
        assert!(is_data_conflict_error("numeric value out of range"));
    }

    #[test]
    fn is_data_conflict_error_returns_false_for_network_errors() {
        assert!(!is_data_conflict_error("connection refused"));
        assert!(!is_data_conflict_error("timeout exceeded"));
        assert!(!is_data_conflict_error("unknown table"));
    }

    #[test]
    fn deleted_at_clause_uses_coalesce_for_tombstone_protection() {
        for table in DELETED_AT_TABLES {
            let keys: Vec<String> = vec!["updated_at".into(), "deleted_at".into(), "title".into()];
            let mut clauses: Vec<String> =
                keys.iter().map(|k| format!("{k} = EXCLUDED.{k}")).collect();
            if let Some(pos) = clauses.iter().position(|c| c.starts_with("deleted_at =")) {
                clauses[pos] = format!(
                    "deleted_at = COALESCE(EXCLUDED.deleted_at, {table}.deleted_at)"
                );
            }
            let combined = clauses.join(", ");
            assert!(
                combined.contains(&format!("deleted_at = COALESCE(EXCLUDED.deleted_at, {table}.deleted_at)")),
                "table={table} combined={combined}"
            );
        }
    }

    #[test]
    fn deleted_at_clause_not_touched_for_junction_tables() {
        for table in &["contact_tag", "project_contact", "note_entity", "entity_links"] {
            let keys: Vec<String> = vec!["deleted_at".into(), "role".into()];
            let mut clauses: Vec<String> =
                keys.iter().map(|k| format!("{k} = EXCLUDED.{k}")).collect();
            if DELETED_AT_TABLES.contains(table) {
                if let Some(pos) = clauses.iter().position(|c| c.starts_with("deleted_at =")) {
                    clauses[pos] = format!(
                        "deleted_at = COALESCE(EXCLUDED.deleted_at, {table}.deleted_at)"
                    );
                }
            }
            let combined = clauses.join(", ");
            assert!(
                !combined.contains("COALESCE"),
                "junction table {table} should not get COALESCE: {combined}"
            );
        }
    }

    /// The client's `ENTITY_KINDS` (src-tauri/src/sync/translate.rs) is what it
    /// iterates over when bootstrapping, and `push` looks its table up here. A
    /// kind the client sends but this list lacks is a hard failure that has
    /// already bitten us once (`note` / `note_entity` → every note upload
    /// rejected with "unknown entity kind").
    #[test]
    fn sync_tables_cover_every_client_kind() {
        const CLIENT_KINDS: &[&str] = &[
            "contact", "tag", "project", "setting", "note", "event", "action",
            "interaction", "reminder", "contact_tag", "project_contact", "media",
            "entity_link", "note_entity",
        ];
        for kind in CLIENT_KINDS {
            assert!(
                table_for_kind(kind).is_some(),
                "client pushes `{kind}` but SYNC_TABLES has no table for it"
            );
        }
        let mut kinds: Vec<&str> = SYNC_TABLES.iter().map(|(k, _)| *k).collect();
        let total = kinds.len();
        kinds.sort_unstable();
        kinds.dedup();
        assert_eq!(kinds.len(), total, "duplicate kind in SYNC_TABLES");
    }

    /// `UPDATED_AT_TABLES` holds **table names**, not kinds — the push handler
    /// looks it up with `table` after mapping the kind through `SYNC_TABLES`.
    ///
    /// A typo here fails silently: `contains()` just returns false, the kind
    /// quietly stops being treated as LWW, and the client goes back to
    /// re-uploading that entire table every cycle with no error raised anywhere.
    /// (The client's list, by contrast, is keyed by *kind* — for the three
    /// tables added on 2026-09-26 the two happen to be spelled identically,
    /// which is exactly the sort of coincidence worth pinning down.)
    #[test]
    fn updated_at_tables_are_real_sync_tables() {
        for name in UPDATED_AT_TABLES {
            assert!(
                SYNC_TABLES.iter().any(|(_, table)| table == name),
                "UPDATED_AT_TABLES lists \"{name}\", which is not a table in \
                 SYNC_TABLES — the push handler would silently stop treating it \
                 as LWW and re-upload that table in full on every cycle"
            );
        }
    }

    /// A bootstrap applies pages in `SYNC_TABLES` order with
    /// `PRAGMA foreign_keys=ON`, so a child row must never precede its parent.
    #[test]
    fn snapshot_order_is_fk_parent_first() {
        let deps: &[(&str, &str)] = &[
            ("event", "project"),
            ("event", "contact"),
            ("action", "project"),
            ("action", "contact"),
            ("interaction", "contact"),
            ("interaction", "action"),
            ("interaction", "event"),
            ("reminder", "contact"),
            ("reminder", "event"),
            ("contact_tag", "contact"),
            ("contact_tag", "tag"),
            ("project_contact", "project"),
            ("project_contact", "contact"),
            ("note_entity", "note"),
        ];
        let pos = |kind: &str| {
            SYNC_TABLES
                .iter()
                .position(|(k, _)| *k == kind)
                .unwrap_or_else(|| panic!("{kind} missing from SYNC_TABLES"))
        };
        for (child, parent) in deps {
            assert!(
                pos(child) > pos(parent),
                "snapshot order: `{child}` must be listed after its parent `{parent}`"
            );
        }
    }

    #[test]
    fn archived_filter_tables_are_syncable() {
        for kind in ARCHIVED_AT_TABLES {
            assert!(
                table_for_kind(kind).is_some(),
                "ARCHIVED_AT_TABLES names `{kind}`, which is not a synced kind"
            );
        }
    }

    /// The two archive lists answer the same question from opposite ends:
    /// `ARCHIVED_AT_TABLES` decides what a brand-new device is *spared*, and
    /// `PURGEABLE_TABLES` what retention eventually *deletes*.
    ///
    /// A table in the first but not the second would mean the snapshot hides
    /// rows that nothing ever cleans — they would accumulate invisibly. The
    /// reverse is the drift that actually happened: `contact` was added to
    /// `PURGEABLE_TABLES` and not here, so every new device downloaded archived
    /// contacts that the sweep deleted again a few syncs later (and the cascade
    /// behind each one — contact_tag / project_contact / reminder — is the
    /// expensive half, not the single row).
    #[test]
    fn archived_filter_tables_are_a_subset_of_purgeable_tables() {
        for kind in ARCHIVED_AT_TABLES {
            assert!(
                crate::handlers::archive_purge::PURGEABLE_TABLES.contains(kind),
                "ARCHIVED_AT_TABLES lists `{kind}` but PURGEABLE_TABLES does not — the \
                 snapshot would spare rows that retention never removes"
            );
        }
    }

    /// The echo filter lives in one string literal. Deleting a clause from it
    /// breaks nothing loudly — no error, no failed request, just every device
    /// pulling its own uploads back and replaying them through `apply_change`.
    /// The symptom is "sync feels slow again", so pin the parts that matter.
    #[test]
    fn pull_sql_excludes_the_requesting_device() {
        assert!(
            PULL_SQL.contains("device_id <> $4"),
            "pull must skip changes authored by the calling device"
        );
        // Rows written by scheduled server work (archive_purge runs with no
        // request context, so `app.current_device_id` is unset) and rows
        // predating the column carry NULL. They must still reach every device —
        // a retention delete that stops propagating lets clients resurrect the
        // row on their next push.
        assert!(
            PULL_SQL.contains("device_id IS NULL"),
            "NULL device_id rows must keep being delivered"
        );
        // A client that sends nothing must fall back to the old behaviour
        // (pull everything), so the two ends can be deployed in either order.
        assert!(
            PULL_SQL.contains("$4::text IS NULL"),
            "an absent request device_id must disable the filter, not the query"
        );
    }

    /// The bind order is positional. Adding the device filter swapped an inline
    /// query for a named constant, which is exactly when a placeholder gets
    /// renumbered and the wrong value lands in the wrong slot.
    ///
    /// Counts *distinct* numbers, not `$` characters: `$4` legitimately appears
    /// twice (the filter reuses one parameter), so counting symbols would
    /// report a phantom fifth bind.
    #[test]
    fn pull_sql_binds_exactly_four_placeholders() {
        let mut numbers: Vec<u32> = PULL_SQL
            .match_indices('$')
            .filter_map(|(i, _)| PULL_SQL[i + 1..].chars().next()?.to_digit(10))
            .collect();
        numbers.sort_unstable();
        numbers.dedup();
        assert_eq!(
            numbers,
            vec![1, 2, 3, 4],
            "PULL_SQL must reference exactly $1..$4 — the handler binds four values"
        );
    }

    /// Clients built before the field existed send `{since_revision, limit}`
    /// only. A missing field must deserialize to `None` (filter off) rather
    /// than 400 the whole pull — that would take every un-upgraded device
    /// offline the moment this ships.
    #[test]
    fn pull_req_without_device_id_is_accepted() {
        let req: PullReq = serde_json::from_value(serde_json::json!({
            "since_revision": 42,
            "limit": 500
        }))
        .expect("a request without device_id must still deserialize");

        assert_eq!(req.since_revision, 42);
        assert!(req.device_id.is_none(), "absent device_id must mean `no filter`");
    }
}
