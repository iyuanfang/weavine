use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::{extract_auth, extract_auth_with_device};
use weavine_lib::models::Event;

/// Compute the RFC3339 trigger time for an event reminder:
/// `trigger_at = start_at - lead_minutes`. Accepts RFC3339 (clients)
/// or legacy space-separated `%Y-%m-%d %H:%M:%S` input.
fn compute_trigger_at(start_at: &str, lead_minutes: i64) -> Option<String> {
    if lead_minutes <= 0 {
        return None;
    }
    let dt = chrono::DateTime::parse_from_rfc3339(start_at)
        .map(|d| d.with_timezone(&chrono::Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(start_at, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|n| n.and_utc())
        })?;
    Some((dt - chrono::Duration::minutes(i64::from(lead_minutes))).to_rfc3339())
}

/// Derive (or update) the `kind='time'` reminder row for an event.
/// The `invitation_token` is `event:{event_id}:{lead_minutes}`, which is
/// stable across server and client so both sides converge on one row.
/// On UPDATE the existing row is reused (dispatch history preserved);
/// when the lead is removed the matching reminder is deleted.
async fn upsert_event_reminder(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    event_id: &str,
    contact_id: Option<&str>,
    start_at: &str,
    lead_minutes: i64,
    old_lead_minutes: Option<i64>,
) -> Result<(), sqlx::Error> {
    if lead_minutes <= 0 {
        if let Some(old) = old_lead_minutes.filter(|&l| l > 0) {
            let old_token = format!("event:{event_id}:{old}");
            sqlx::query("DELETE FROM reminder WHERE invitation_token = $1")
                .bind(&old_token)
                .execute(&mut **tx)
                .await?;
        }
        return Ok(());
    }
    let Some(trigger_at) = compute_trigger_at(start_at, lead_minutes) else {
        return Ok(());
    };
    let new_token = format!("event:{event_id}:{lead_minutes}");
    let old_token = old_lead_minutes
        .filter(|&l| l > 0)
        .map(|l| format!("event:{event_id}:{l}"));
    let now = super::now_str();

    let existing: Option<String> = if let Some(ot) = &old_token {
        sqlx::query_scalar(
            "SELECT id FROM reminder WHERE invitation_token = $1 AND deleted_at IS NULL LIMIT 1",
        )
        .bind(ot)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        None
    };
    let existing: Option<String> = if existing.is_none() {
        sqlx::query_scalar(
            "SELECT id FROM reminder WHERE invitation_token = $1 AND deleted_at IS NULL LIMIT 1",
        )
        .bind(&new_token)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        existing
    };

    match existing {
        Some(rid) => {
            sqlx::query(
                "UPDATE reminder SET trigger_at = $1, invitation_token = $2, contact_id = $3, event_id = $4 \
                 WHERE id = $5",
            )
            .bind(&trigger_at)
            .bind(&new_token)
            .bind(contact_id)
            .bind(event_id)
            .bind(&rid)
            .execute(&mut **tx)
            .await?;
        }
        None => {
            let rid = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO reminder (id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at) \
                 VALUES ($1,$2,$3,$4,$5,'time',false,false,$6,$7)",
            )
            .bind(&rid)
            .bind(user_id)
            .bind(contact_id)
            .bind(event_id)
            .bind(&trigger_at)
            .bind(&new_token)
            .bind(&now)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

const EVENT_SELECT: &str = "SELECT e.id, e.user_id, e.title, e.event_type, e.start_at, e.end_at, e.location, \
     e.contact_id, e.project_id, e.reminder_lead_minutes::BIGINT AS reminder_lead_minutes, e.archived_at, e.created_at, e.updated_at, \
     c.nickname AS contact_nickname, p.title AS project_title \
     FROM event e \
     LEFT JOIN contact c ON c.id = e.contact_id AND c.user_id = e.user_id \
     LEFT JOIN project p ON p.id = e.project_id AND p.user_id = e.user_id";

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ParticipantRow {
    pub contact_id: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventWithParticipants {
    #[serde(flatten)]
    pub event: Event,
    pub participants: Vec<ParticipantRow>,
}

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub start_after: Option<String>,
    pub start_before: Option<String>,
    pub archived: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct UpcomingParams {
    pub user_id: Option<String>,
    pub limit: Option<i64>,
}

pub async fn list(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<EventWithParticipants>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let events = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.user_id = $1 \
         AND ($2::text IS NULL OR e.contact_id = $2) \
         AND ($3::text IS NULL OR e.project_id = $3) \
         AND ($4::text IS NULL OR e.start_at >= $4) \
         AND ($5::text IS NULL OR e.start_at <= $5) \
         AND ($6::text IS NULL OR ($6::text = 'true' AND e.archived_at IS NOT NULL) OR ($6::text = 'false' AND e.archived_at IS NULL)) \
         AND e.deleted_at IS NULL \
         ORDER BY e.start_at DESC LIMIT $7",
    ))
    .bind(&auth)
    .bind(&p.contact_id)
    .bind(&p.project_id)
    .bind(&p.start_after)
    .bind(&p.start_before)
    .bind(&p.archived)
    .bind(p.limit.unwrap_or(100))
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let event_ids: Vec<String> = events.iter().map(|e| e.id.clone()).collect();
    let parts_map = fetch_participants_for_events(&*pool, &event_ids)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let result: Vec<EventWithParticipants> = events
        .into_iter()
        .map(|e| {
            let participants = parts_map.get(&e.id).cloned().unwrap_or_default();
            EventWithParticipants { event: e, participants }
        })
        .collect();
    Ok(Json(result))
}

pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<Value>,
) -> Result<Json<EventWithParticipants>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = super::now_str();

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
        "INSERT INTO event (id, user_id, title, event_type, start_at, end_at, location, \
         contact_id, project_id, reminder_lead_minutes, created_at, updated_at) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    )
    .bind(&id)
    .bind(&auth)
    .bind(body.get("title").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(body.get("type").or_else(|| body.get("event_type")).and_then(|v| v.as_str()).unwrap_or("event"))
    .bind(body.get("start_at").and_then(|v| v.as_str()).unwrap_or(&now))
    .bind(body.get("end_at").and_then(|v| v.as_str()))
    .bind(body.get("location").and_then(|v| v.as_str()))
    .bind(body.get("contact_id").and_then(|v| v.as_str()))
    .bind(body.get("project_id").and_then(|v| v.as_str()))
    .bind(body.get("reminder_lead_minutes").and_then(|v| v.as_i64()))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut participant_ids: Vec<String> = Vec::new();
    if let Some(arr) = body.get("participant_contact_ids").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(s) = v.as_str() {
                participant_ids.push(s.to_string());
            }
        }
        participant_ids.sort();
        participant_ids.dedup();
    }
    if !participant_ids.is_empty() {
        for cid in &participant_ids {
            sqlx::query(
                "INSERT INTO entity_links (user_id, from_type, from_id, to_type, to_id, relation_type, role) \
                 VALUES ($1, 'event', $2, 'contact', $3, 'participated', 'participant') \
                 ON CONFLICT (user_id, from_type, from_id, to_type, to_id, relation_type) DO NOTHING"
            )
            .bind(&auth)
            .bind(&id)
            .bind(cid)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
        sqlx::query(
            "UPDATE event SET contact_id=$1, updated_at=$2 WHERE id=$3"
        )
        .bind(&participant_ids[0])
        .bind(&now)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let lead = body.get("reminder_lead_minutes").and_then(|v| v.as_i64());
    if let Some(lead) = lead.filter(|&l| l > 0) {
        let start_at = body.get("start_at").and_then(|v| v.as_str()).unwrap_or(&now);
        let contact_id = if participant_ids.is_empty() {
            body.get("contact_id").and_then(|v| v.as_str())
        } else {
            Some(participant_ids[0].as_str())
        };
        upsert_event_reminder(&mut tx, &auth, &id, contact_id, start_at, lead, None)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.id = $1 AND e.deleted_at IS NULL",
    ))
    .bind(&id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let participants = fetch_participants(&*pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(EventWithParticipants { event, participants }))
}

pub async fn get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<Json<EventWithParticipants>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let event = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2 AND e.deleted_at IS NULL",
    ))
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "事件不存在".to_string()))?;
    let participants = fetch_participants(&*pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(EventWithParticipants { event, participants }))
}

pub async fn update(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<EventWithParticipants>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let now = super::now_str();

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let old: Option<(Option<i64>, String)> = sqlx::query_as(
        // Cast reminder_lead_minutes to BIGINT so sqlx can decode it into
        // Option<i64>. The Rust Event struct uses i64 (matching EVENT_SELECT's
        // cast at the top of this file) but the underlying column is INT4.
        "SELECT reminder_lead_minutes::BIGINT AS reminder_lead_minutes, start_at \
         FROM event WHERE id = $1 AND user_id = $2",
    )
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (old_lead, old_start_at) = old.unwrap_or((None, String::new()));

    enum Bind<'a> {
        Text(&'a str),
        I64(i64),
    }

    let mut sets = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    let mut idx = 1u32;
    for field in &["title", "event_type", "start_at", "end_at", "location", "contact_id", "project_id"] {
        if let Some(v) = body.get(field).and_then(|v| v.as_str()) {
            sets.push(format!("{} = ${}", field, idx));
            binds.push(Bind::Text(v));
            idx += 1;
        }
    }
    if let Some(v) = body.get("reminder_lead_minutes").and_then(|v| v.as_i64()) {
        sets.push(format!("reminder_lead_minutes = ${}", idx));
        binds.push(Bind::I64(v));
        idx += 1;
    }
    if let Some(v) = body.get("archived_at").and_then(|v| v.as_str()) {
        sets.push(format!("archived_at = ${}", idx));
        binds.push(Bind::Text(v));
        idx += 1;
    }
    sets.push(format!("updated_at = ${}", idx));
    binds.push(Bind::Text(&now));
    idx += 1;
    let sql = format!(
        "UPDATE event SET {} WHERE id = ${} AND user_id = ${}",
        sets.join(", "), idx, idx + 1
    );
    let mut q = sqlx::query(&sql);
    for b in &binds {
        q = match b {
            Bind::Text(s) => q.bind(*s),
            Bind::I64(n) => q.bind(*n),
        };
    }
    q = q.bind(&id).bind(&auth);
    q.execute(&mut *tx).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(arr) = body.get("participant_contact_ids").and_then(|v| v.as_array()) {
        let mut new_ids: Vec<String> = arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        new_ids.sort();
        new_ids.dedup();

        sqlx::query(
            "DELETE FROM entity_links WHERE user_id=$1 AND from_type='event' AND from_id=$2 AND relation_type='participated'"
        )
        .bind(&auth)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        for cid in &new_ids {
            sqlx::query(
                "INSERT INTO entity_links (user_id, from_type, from_id, to_type, to_id, relation_type, role) \
                 VALUES ($1, 'event', $2, 'contact', $3, 'participated', 'participant')"
            )
            .bind(&auth)
            .bind(&id)
            .bind(cid)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }

        let new_first: Option<&String> = new_ids.first();
        sqlx::query("UPDATE event SET contact_id=$1, updated_at=$2 WHERE id=$3")
            .bind(new_first.cloned().unwrap_or_default())
            .bind(&now)
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let body_lead = body.get("reminder_lead_minutes");
    let lead_present = body_lead.is_some();
    let new_lead: Option<i64> = body_lead.and_then(|v| v.as_i64());
    let new_start_at: Option<&str> = body.get("start_at").and_then(|v| v.as_str());
    let lead_changed = lead_present && new_lead != old_lead;
    let start_changed = new_start_at.is_some() && new_start_at != Some(old_start_at.as_str());
    if lead_changed || start_changed {
        let effective_lead = if lead_present { new_lead } else { old_lead };
        let effective_start = new_start_at.unwrap_or(&old_start_at);
        let contact_id: Option<String> = sqlx::query_as::<_, (Option<String>,)>(
            "SELECT contact_id FROM event WHERE id = $1",
        )
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .0;
        match effective_lead {
            Some(lead) if lead > 0 => {
                upsert_event_reminder(
                    &mut tx,
                    &auth,
                    &id,
                    contact_id.as_deref(),
                    effective_start,
                    lead,
                    old_lead,
                )
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            }
            _ => {
                if let Some(old) = old_lead.filter(|&l| l > 0) {
                    let old_token = format!("event:{id}:{old}");
                    sqlx::query("DELETE FROM reminder WHERE invitation_token = $1")
                        .bind(&old_token)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                }
            }
        }
    }

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let event = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.id = $1 AND e.user_id = $2 AND e.deleted_at IS NULL",
    ))
    .bind(&id)
    .bind(&auth)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "事件不存在".to_string()))?;
    let participants = fetch_participants(&*pool, &id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(EventWithParticipants { event, participants }))
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

    sqlx::query("UPDATE event SET deleted_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL")
        .bind(&id).bind(&auth)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // reminder table has no updated_at column (only created_at + server_revision);
    // the trigger already bumps server_revision on UPDATE, so no extra timestamp needed.
    sqlx::query("UPDATE reminder SET deleted_at = now() WHERE event_id = $1 AND deleted_at IS NULL")
        .bind(&id)
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(()))
}

pub async fn upcoming(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<UpcomingParams>,
) -> Result<Json<Vec<EventWithParticipants>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let now = super::now_str();
    let events = sqlx::query_as::<_, Event>(&format!(
        "{EVENT_SELECT} WHERE e.user_id = $1 AND e.start_at >= $2 AND e.archived_at IS NULL AND e.deleted_at IS NULL \
         ORDER BY e.start_at LIMIT $3",
    ))
    .bind(&auth).bind(&now)
    .bind(p.limit.unwrap_or(20))
    .fetch_all(&*pool).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let event_ids: Vec<String> = events.iter().map(|e| e.id.clone()).collect();
    let parts_map = fetch_participants_for_events(&*pool, &event_ids)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let result: Vec<EventWithParticipants> = events
        .into_iter()
        .map(|e| {
            let participants = parts_map.get(&e.id).cloned().unwrap_or_default();
            EventWithParticipants { event: e, participants }
        })
        .collect();
    Ok(Json(result))
}
async fn fetch_participants(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
) -> Result<Vec<ParticipantRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT el.to_id AS contact_id, el.role, c.nickname AS nickname \
         FROM entity_links el \
         LEFT JOIN contact c ON c.id = el.to_id AND c.user_id = el.user_id \
         WHERE el.from_type='event' AND el.from_id=$1 AND el.relation_type='participated' \
         ORDER BY el.created_at ASC"
    )
    .bind(event_id)
    .fetch_all(executor)
    .await
}

async fn fetch_participants_for_events(
    executor: impl sqlx::PgExecutor<'_>,
    event_ids: &[String],
) -> Result<std::collections::HashMap<String, Vec<ParticipantRow>>, sqlx::Error> {
    use std::collections::HashMap;
    let mut out: HashMap<String, Vec<ParticipantRow>> = HashMap::new();
    if event_ids.is_empty() {
        return Ok(out);
    }
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT el.from_id, el.to_id AS contact_id, c.nickname AS nickname \
         FROM entity_links el \
         LEFT JOIN contact c ON c.id = el.to_id AND c.user_id = el.user_id \
         WHERE el.from_type='event' AND el.from_id = ANY($1) AND el.relation_type='participated' \
         ORDER BY el.created_at ASC"
    )
    .bind(event_ids)
    .fetch_all(executor)
    .await?;
    for (event_id, contact_id, nickname) in rows {
        out.entry(event_id).or_default().push(ParticipantRow {
            contact_id,
            role: "participant".into(),
            nickname,
        });
    }
    Ok(out)
}

async fn sync_main_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
) -> Result<(), sqlx::Error> {
    let first: Option<(String,)> = sqlx::query_as(
        "SELECT to_id FROM entity_links \
         WHERE from_type='event' AND from_id=$1 AND relation_type='participated' \
         ORDER BY created_at ASC LIMIT 1"
    )
    .bind(event_id)
    .fetch_optional(&mut **tx)
    .await?;
    sqlx::query("UPDATE event SET contact_id=$1, updated_at=$2 WHERE id=$3")
        .bind(first.map(|(c,)| c))
        .bind(super::now_str())
        .bind(event_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn validate_role(role: &str) -> bool {
    matches!(role, "organizer" | "participant" | "referred" | "mentioned")
}

async fn authorize_event(
    executor: impl sqlx::PgExecutor<'_>,
    event_id: &str,
    user_id: &str,
    for_update: bool,
) -> Result<(), (StatusCode, String)> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let q = format!(
        "SELECT user_id FROM event WHERE id=$1 AND deleted_at IS NULL{lock}"
    );
    let owner: Option<(String,)> = sqlx::query_as(&q)
        .bind(event_id)
        .fetch_optional(executor)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match owner {
        Some((u,)) if u == user_id => Ok(()),
        Some(_) => Err((StatusCode::FORBIDDEN, "无权访问".into())),
        None => Err((StatusCode::NOT_FOUND, "事件不存在".into())),
    }
}

pub async fn list_participants(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
) -> Result<Json<Vec<ParticipantRow>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    let rows = fetch_participants(&*pool, &event_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rows))
}

pub async fn add_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(event_id): Path<String>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    let role = if validate_role(&body.role) { body.role.clone() } else { "participant".to_string() };
    sqlx::query(
        "INSERT INTO entity_links (user_id, from_type, from_id, to_type, to_id, relation_type, role) \
         VALUES ($1, 'event', $2, 'contact', $3, 'participated', $4) \
         ON CONFLICT (user_id, from_type, from_id, to_type, to_id, relation_type) \
         DO UPDATE SET role = EXCLUDED.role"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&body.contact_id)
    .bind(&role)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ParticipantRow { contact_id: body.contact_id, role, nickname: None }))
}

pub async fn set_participant_role(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
    Json(body): Json<ParticipantRow>,
) -> Result<Json<ParticipantRow>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    authorize_event(&*pool, &event_id, &auth, false).await?;
    if !validate_role(&body.role) {
        return Err((StatusCode::BAD_REQUEST, "无效角色".into()));
    }
    let rows = sqlx::query(
        "UPDATE entity_links SET role=$1 \
         WHERE user_id=$2 AND from_type='event' AND from_id=$3 AND to_id=$4 \
           AND relation_type='participated'"
    )
    .bind(&body.role)
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if rows.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "参与者不存在".into()));
    }
    Ok(Json(ParticipantRow { contact_id, role: body.role, nickname: None }))
}

pub async fn remove_participant(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path((event_id, contact_id)): Path<(String, String)>,
) -> Result<(StatusCode, ()), (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let mut tx = pool.begin().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize_event(&mut *tx, &event_id, &auth, true).await?;
    sqlx::query(
        "DELETE FROM entity_links \
         WHERE user_id=$1 AND from_type='event' AND from_id=$2 AND to_id=$3 \
           AND relation_type='participated'"
    )
    .bind(&auth)
    .bind(&event_id)
    .bind(&contact_id)
    .execute(&mut *tx).await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sync_main_participant(&mut tx, &event_id).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit().await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::NO_CONTENT, ()))
}

#[cfg(test)]
mod tests {
    use super::{compute_trigger_at, upsert_event_reminder};
    use sqlx::PgPool;
    use crate::handlers::now_str;

    #[test]
    fn test_compute_trigger_at_rfc3339() {
        let result = compute_trigger_at("2026-08-15T10:00:00+00:00", 15);
        assert_eq!(result, Some("2026-08-15T09:45:00+00:00".to_string()));
    }

    #[test]
    fn test_compute_trigger_at_space_format() {
        let result = compute_trigger_at("2026-08-15 10:00:00", 30);
        assert_eq!(result, Some("2026-08-15T09:30:00+00:00".to_string()));
    }

    #[test]
    fn test_compute_trigger_at_zero_lead() {
        assert_eq!(compute_trigger_at("2026-08-15T10:00:00+00:00", 0), None);
    }

    #[test]
    fn test_compute_trigger_at_negative_lead() {
        assert_eq!(compute_trigger_at("2026-08-15T10:00:00+00:00", -5), None);
    }

    #[test]
    fn test_compute_trigger_at_invalid_date() {
        assert_eq!(compute_trigger_at("not-a-date", 15), None);
    }

    #[sqlx::test]
    async fn test_upsert_event_reminder_creates_reminder(pool: PgPool) {
        let user_id = uuid::Uuid::new_v4().to_string();
        let contact_id = uuid::Uuid::new_v4().to_string();
        let event_id = uuid::Uuid::new_v4().to_string();
        let now = now_str();

        sqlx::query("INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(&user_id)
            .bind(&format!("{}@test.com", &user_id[..8]))
            .bind("fake_hash")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO contact (id, user_id, nickname, last_interaction_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$4,$5)")
            .bind(&contact_id)
            .bind(&user_id)
            .bind("Test Contact")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO event (id, user_id, title, start_at, reminder_lead_minutes, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&event_id)
        .bind(&user_id)
        .bind("Test Event")
        .bind("2026-08-15T10:00:00+00:00")
        .bind(15i64)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        upsert_event_reminder(
            &mut tx,
            &user_id,
            &event_id,
            Some(&contact_id),
            "2026-08-15T10:00:00+00:00",
            15,
            None,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row: (String, String, Option<String>, String, i32) = sqlx::query_as(
            "SELECT r.id, r.user_id, r.contact_id, r.invitation_token, \
             CAST(EXTRACT(EPOCH FROM r.trigger_at::timestamptz) AS INTEGER) \
             FROM reminder r WHERE r.event_id = $1",
        )
        .bind(&event_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(row.1, user_id);
        assert_eq!(row.2, Some(contact_id.clone()));
        assert_eq!(row.3, format!("event:{event_id}:15"));
        assert_eq!(row.4, 1786787100);
    }

    #[sqlx::test]
    async fn test_upsert_event_reminder_reuses_existing(pool: PgPool) {
        let user_id = uuid::Uuid::new_v4().to_string();
        let contact_id = uuid::Uuid::new_v4().to_string();
        let event_id = uuid::Uuid::new_v4().to_string();
        let now = now_str();

        sqlx::query("INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(&user_id)
            .bind(&format!("{}@test.com", &user_id[..8]))
            .bind("fake_hash")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO contact (id, user_id, nickname, last_interaction_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$4,$5)")
            .bind(&contact_id)
            .bind(&user_id)
            .bind("Test Contact")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO event (id, user_id, title, start_at, reminder_lead_minutes, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&event_id)
        .bind(&user_id)
        .bind("Test Event")
        .bind("2026-08-15T10:00:00+00:00")
        .bind(15i64)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        upsert_event_reminder(
            &mut tx,
            &user_id,
            &event_id,
            Some(&contact_id),
            "2026-08-15T10:00:00+00:00",
            15,
            None,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        upsert_event_reminder(
            &mut tx,
            &user_id,
            &event_id,
            Some(&contact_id),
            "2026-08-15T10:00:00+00:00",
            15,
            Some(15),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM reminder WHERE event_id = $1",
        )
        .bind(&event_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1, "must preserve dispatch history, not create duplicate");
    }

    #[sqlx::test]
    async fn test_upsert_event_reminder_deletes_when_lead_removed(pool: PgPool) {
        let user_id = uuid::Uuid::new_v4().to_string();
        let contact_id = uuid::Uuid::new_v4().to_string();
        let event_id = uuid::Uuid::new_v4().to_string();
        let now = now_str();

        sqlx::query("INSERT INTO user_account (id, email, password_hash, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)")
            .bind(&user_id)
            .bind(&format!("{}@test.com", &user_id[..8]))
            .bind("fake_hash")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO contact (id, user_id, nickname, last_interaction_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$4,$5)")
            .bind(&contact_id)
            .bind(&user_id)
            .bind("Test Contact")
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query(
            "INSERT INTO event (id, user_id, title, start_at, reminder_lead_minutes, created_at, updated_at) \
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&event_id)
        .bind(&user_id)
        .bind("Test Event")
        .bind("2026-08-15T10:00:00+00:00")
        .bind(15i64)
        .bind(&now)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        upsert_event_reminder(
            &mut tx,
            &user_id,
            &event_id,
            Some(&contact_id),
            "2026-08-15T10:00:00+00:00",
            15,
            None,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        upsert_event_reminder(
            &mut tx,
            &user_id,
            &event_id,
            Some(&contact_id),
            "2026-08-15T10:00:00+00:00",
            0,
            Some(15),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM reminder WHERE event_id = $1 AND deleted_at IS NULL",
        )
        .bind(&event_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "reminder must be deleted when lead is removed");
    }
}