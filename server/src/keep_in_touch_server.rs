//! Cloud-side keep-in-touch scheduler.
//!
//! Runs an hourly tick that mirrors the desktop `business::keep_in_touch`
//! logic against Postgres:
//!
//!   1. For each contact with a `last_interaction_at`, compute the
//!      cadence (override or importance default).
//!   2. Compute `trigger_at = last_interaction_at + cadence_days`.
//!   3. Delete any existing dispatched=0 AND dismissed=0
//!      `kind='keep_in_touch'` reminder for the contact.
//!   4. Insert a fresh reminder row.
//!
//! Mirroring the desktop app's `schedule_for_contact_tx` semantics; the
//! desktop side reacts to interactions in real time, while the cloud
//! side batches every hour. This means the desktop is authoritative
//! when both are online; the cloud only catches up.

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

fn cadence_days(importance: &str, override_days: Option<i64>) -> i64 {
    if let Some(d) = override_days.filter(|d| *d > 0) {
        return d;
    }
    match importance {
        "high" => 30,
        "medium" => 90,
        "low" => 180,
        _ => 180,
    }
}

const TICK_INTERVAL_SECS: u64 = 3600;
const INITIAL_DELAY_SECS: u64 = 30;

pub fn spawn_keep_in_touch_scheduler(pool: Arc<PgPool>) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(INITIAL_DELAY_SECS)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(TICK_INTERVAL_SECS));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match tick_keep_in_touch(Utc::now(), &pool).await {
                Ok(n) if n > 0 => {
                    eprintln!("[keep-in-touch] rescheduled {n} reminders");
                }
                Ok(_) => {}
                Err(e) => eprintln!("[keep-in-touch] tick error: {e}"),
            }
        }
    });
}

async fn tick_keep_in_touch(
    now: DateTime<Utc>,
    pool: &PgPool,
) -> Result<usize, sqlx::Error> {
    let rows: Vec<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id, importance, last_interaction_at, keep_in_touch_cadence_days \
         FROM contact WHERE last_interaction_at IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;

    let mut updated = 0usize;
    for (contact_id, importance, last_iso, override_days) in rows {
        let Some(last_iso) = last_iso else { continue };
        let last = match DateTime::parse_from_rfc3339(&last_iso) {
            Ok(d) => d.with_timezone(&Utc),
            Err(_) => continue,
        };
        let days = cadence_days(&importance, override_days);
        let trigger_at = (last + Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

        let mut tx = pool.begin().await?;

        let _ = sqlx::query(
            "DELETE FROM reminder \
             WHERE contact_id = $1 AND kind = 'keep_in_touch' \
               AND dispatched = false AND dismissed = false",
        )
        .bind(&contact_id)
        .execute(&mut *tx)
        .await?;

        let id = format!("kit-{}", Uuid::new_v4());
        let now_str = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        sqlx::query(
            "INSERT INTO reminder \
                (id, user_id, contact_id, event_id, trigger_at, kind, \
                 dispatched, dismissed, invitation_token, created_at) \
             SELECT $1, user_id, $2, NULL, $3, 'keep_in_touch', \
                    false, false, NULL, $4 \
             FROM contact WHERE id = $2",
        )
        .bind(&id)
        .bind(&contact_id)
        .bind(&trigger_at)
        .bind(&now_str)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        updated += 1;
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cadence_default_falls_back_to_importance() {
        assert_eq!(cadence_days("high", None), 30);
        assert_eq!(cadence_days("medium", None), 90);
        assert_eq!(cadence_days("low", None), 180);
        assert_eq!(cadence_days("garbage", None), 180);
    }

    #[test]
    fn cadence_override_beats_importance() {
        assert_eq!(cadence_days("high", Some(7)), 7);
        assert_eq!(cadence_days("medium", Some(60)), 60);
    }

    #[test]
    fn zero_or_negative_override_falls_back() {
        assert_eq!(cadence_days("high", Some(0)), 30);
        assert_eq!(cadence_days("high", Some(-5)), 30);
    }
}