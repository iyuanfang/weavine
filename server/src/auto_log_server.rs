//! Cloud-side auto-log: keep `contact.last_interaction_at` current for
//! not-yet-archived ended events. Interaction writes happen in
//! `event.rs::update` + `action.rs::update` archive hooks (cross-stack
//! parity with desktop); see those for the unified contract.

use chrono::{Duration, Utc};
use sqlx::PgPool;

const SEVEN_DAYS: i64 = 7;

#[derive(sqlx::FromRow)]
struct EndedEvent {
    id: String,
    user_id: String,
    end_at: String,
}

pub async fn tick_auto_log(
    pool: &PgPool,
) -> Result<usize, sqlx::Error> {
    let cutoff = Utc::now() - Duration::days(SEVEN_DAYS);
    let cutoff_str = cutoff.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let rows: Vec<EndedEvent> = sqlx::query_as(
        "SELECT e.id, e.user_id, e.end_at \
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

    let mut bumped = 0usize;
    for ev in rows {
        bumped += bump_last_interaction_for_event(pool, ev).await?;
    }
    Ok(bumped)
}

async fn bump_last_interaction_for_event(
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

    if participants.is_empty() {
        return Ok(0);
    }

    let mut bumped = 0usize;
    let mut tx = pool.begin().await?;
    for contact_id in participants {
        let res = sqlx::query(
            "UPDATE contact SET last_interaction_at = $1 \
             WHERE id = $2 AND user_id = $3 \
               AND (last_interaction_at IS NULL OR last_interaction_at < $1)",
        )
        .bind(&ev.end_at)
        .bind(&contact_id)
        .bind(&ev.user_id)
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() > 0 {
            bumped += 1;
        }
    }
    tx.commit().await?;
    Ok(bumped)
}