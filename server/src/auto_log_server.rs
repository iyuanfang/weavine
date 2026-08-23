//! Cloud-side auto-log: write one Interaction per ended-event participant.
//!
//! Mirrors the desktop `business::auto_log` against Postgres. Server
//! schedules it hourly (alongside `keep_in_touch_server`) so signed-in
//! desktop clients catch up via sync, and the cloud acts as the source
//! of truth for offline-driven installs.

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

const SEVEN_DAYS: i64 = 7;

#[derive(sqlx::FromRow)]
struct EndedEvent {
    id: String,
    user_id: String,
    title: String,
    end_at: String,
}

pub async fn tick_auto_log(
    pool: &PgPool,
) -> Result<usize, sqlx::Error> {
    let cutoff = Utc::now() - Duration::days(SEVEN_DAYS);
    let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let rows: Vec<EndedEvent> = sqlx::query_as(
        "SELECT e.id, e.user_id, e.title, e.end_at \
         FROM event e \
         WHERE e.deleted_at IS NULL \
           AND e.archived_at IS NULL \
           AND e.end_at IS NOT NULL \
           AND e.end_at >= $1 \
           AND e.end_at <  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') \
           AND EXISTS ( \
               SELECT 1 FROM entity_links el \
               WHERE el.user_id = e.user_id \
                 AND el.from_type = 'event' \
                 AND el.from_id = e.id \
                 AND el.relation_type = 'participated' \
           ) \
         ORDER BY e.end_at ASC",
    )
    .bind(&cutoff_str)
    .fetch_all(pool)
    .await?;

    let mut written = 0usize;
    for ev in rows {
        written += write_interactions_for_event(pool, ev).await?;
    }
    Ok(written)
}

async fn write_interactions_for_event(
    pool: &PgPool,
    ev: EndedEvent,
) -> Result<usize, sqlx::Error> {
    let participants: Vec<String> = sqlx::query_scalar(
        "SELECT el.to_id FROM entity_links el \
         WHERE el.user_id = $1 \
           AND el.from_type = 'event' \
           AND el.from_id = $2 \
           AND el.relation_type = 'participated'",
    )
    .bind(&ev.user_id)
    .bind(&ev.id)
    .fetch_all(pool)
    .await?;

    let mut written = 0usize;
    let now = Utc::now();
    let now_str = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // One transaction for all participants of this event. Previously this
    // was one tx per participant, which meant a 50-person event opened and
    // closed 50 PG transactions per tick. ON CONFLICT DO NOTHING is
    // per-row, so a single duplicate does not poison the rest.
    let mut tx = pool.begin().await?;
    for contact_id in participants {
        let id = format!("auto-{}", uuid::Uuid::new_v4());

        let inserted = sqlx::query(
            "INSERT INTO interaction \
                (id, user_id, contact_id, event_id, occurred_at, summary, source, source_ref, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, 'event', $4, $7) \
             ON CONFLICT (source, source_ref, contact_id)
                WHERE source IS NOT NULL
                  AND source_ref IS NOT NULL
                  AND contact_id IS NOT NULL
                  AND deleted_at IS NULL
                DO NOTHING",
        )
        .bind(&id)
        .bind(&ev.user_id)
        .bind(&contact_id)
        .bind(&ev.id)
        .bind(&ev.end_at)
        .bind(&ev.title)
        .bind(&now_str)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 0 {
            continue;
        }
        sqlx::query(
            "UPDATE contact SET last_interaction_at = $1 \
             WHERE id = $2 AND user_id = $3 \
               AND (last_interaction_at IS NULL OR last_interaction_at < $1)",
        )
        .bind(&ev.end_at)
        .bind(&contact_id)
        .bind(&ev.user_id)
        .execute(&mut *tx)
        .await?;
        written += 1;
    }
    tx.commit().await?;
    Ok(written)
}