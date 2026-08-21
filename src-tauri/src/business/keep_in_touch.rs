//! Keep-in-touch reminders.
//!
//! Each contact gets one `Reminder` row with `kind = 'keep_in_touch'` whose
//! `trigger_at` is computed as `last_interaction_at + cadence_days`. The
//! cadence is either the contact's `keep_in_touch_cadence_days` override or
//! a default derived from `importance`.
//!
//! This module is intentionally simple: only one keep-in-touch reminder
//! exists per contact at any time. Re-scheduling deletes the previous one
//! and inserts a fresh row.
//!
//! Triggered:
//!   - After `interaction::create` (the bump of `last_interaction_at` makes
//!     the next due-date move forward automatically)
//!   - At app startup, for every contact with a non-null
//!     `last_interaction_at` (catches DBs that existed before this feature
//!     landed and DBs whose data was imported from another device).

use rusqlite::{Connection, Transaction};

const DEFAULT_CADENCE: &[(&str, i64)] = &[("high", 30), ("medium", 90), ("low", 180)];

/// Returns the cadence in days for the given contact: explicit override if
/// set, otherwise the default for the contact's `importance`.
fn cadence_days(importance: &str, override_days: Option<i64>) -> i64 {
    if let Some(d) = override_days.filter(|d| *d > 0) {
        return d;
    }
    DEFAULT_CADENCE
        .iter()
        .find(|(k, _)| *k == importance)
        .map(|(_, d)| *d)
        .unwrap_or(180)
}

fn trigger_iso(last_interaction: &str, days: i64) -> Result<String, rusqlite::Error> {
    use std::str::FromStr;
    let dt = chrono::DateTime::parse_from_rfc3339(last_interaction)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let next = dt + chrono::Duration::days(days);
    Ok(next.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

/// Schedule (or re-schedule) the keep-in-touch reminder for one contact.
///
/// Reads the contact's `importance`, `last_interaction_at`, and
/// `keep_in_touch_cadence_days`. If `last_interaction_at` is NULL or the
/// cadence cannot be computed, the existing keep-in-touch reminder (if any)
/// is removed and no row is inserted.
///
/// Must run inside the same transaction that bumped `last_interaction_at`
/// so the new reminder's `trigger_at` matches the freshly-written value.
pub fn schedule_for_contact_tx(
    tx: &Transaction<'_>,
    contact_id: &str,
) -> rusqlite::Result<()> {
    let row: Option<(String, Option<String>, Option<i64>)> = tx
        .query_row(
            "SELECT importance, last_interaction_at, keep_in_touch_cadence_days \
             FROM Contact WHERE id = ?1",
            rusqlite::params![contact_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();

    let Some((importance, Some(last_interaction), override_days)) = row else {
        tx.execute(
            "DELETE FROM Reminder WHERE contact_id = ?1 AND kind = 'keep_in_touch'",
            rusqlite::params![contact_id],
        )?;
        return Ok(());
    };

    let days = cadence_days(&importance, override_days);
    let trigger_at = match trigger_iso(&last_interaction, days) {
        Ok(t) => t,
        Err(_) => return Ok(()),
    };

    tx.execute(
        "DELETE FROM Reminder WHERE contact_id = ?1 AND kind = 'keep_in_touch'",
        rusqlite::params![contact_id],
    )?;

    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let id = format!("kit-{}", contact_id);
    let user_id: String = tx
        .query_row(
            "SELECT user_id FROM Contact WHERE id = ?1",
            rusqlite::params![contact_id],
            |r| r.get(0),
        )?;

    tx.execute(
        "INSERT INTO Reminder \
         (id, user_id, contact_id, trigger_at, kind, dispatched, dismissed, created_at) \
         VALUES (?1, ?2, ?3, ?4, 'keep_in_touch', 0, 0, ?5)",
        rusqlite::params![&id, &user_id, contact_id, &trigger_at, &now],
    )?;

    Ok(())
}

/// Convenience wrapper for callers that don't already hold a transaction
/// (e.g. `contact::update` after the row is updated). Opens its own tx and
/// delegates to `schedule_for_contact_tx`.
pub fn schedule_for_contact(conn: &Connection, contact_id: &str) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    schedule_for_contact_tx(&tx, contact_id)?;
    tx.commit()?;
    Ok(())
}

/// Re-schedule for every contact that has a `last_interaction_at`. Used at
/// app startup so the table reflects any external edits to `Contact`.
pub fn schedule_all(conn: &Connection) -> rusqlite::Result<usize> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM Contact WHERE last_interaction_at IS NOT NULL")?;
        let mapped = stmt.query_map([], |r| r.get::<_, String>(0))?;
        mapped.filter_map(|r| r.ok()).collect()
    };

    let mut count = 0usize;
    for id in &ids {
        let tx = conn.unchecked_transaction()?;
        schedule_for_contact_tx(&tx, id)?;
        tx.commit()?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::migration::run(&conn).unwrap();
        conn
    }

    fn insert_contact(
        conn: &Connection,
        id: &str,
        importance: &str,
        last_iso: Option<&str>,
        cadence_override: Option<i64>,
    ) {
        let now = "2026-08-21T10:00:00.000Z";
        conn.execute(
            "INSERT INTO Contact (id, user_id, nickname, importance, last_interaction_at, \
             keep_in_touch_cadence_days, created_at, updated_at) \
             VALUES (?1, 'local-default', ?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![id, importance, last_iso, cadence_override, now],
        )
        .unwrap();
    }

    #[test]
    fn default_cadence_uses_importance() {
        assert_eq!(cadence_days("high", None), 30);
        assert_eq!(cadence_days("medium", None), 90);
        assert_eq!(cadence_days("low", None), 180);
        assert_eq!(cadence_days("garbage", None), 180);
    }

    #[test]
    fn override_beats_importance_default() {
        assert_eq!(cadence_days("high", Some(7)), 7);
        assert_eq!(cadence_days("medium", Some(60)), 60);
    }

    #[test]
    fn zero_or_negative_override_falls_back_to_default() {
        assert_eq!(cadence_days("high", Some(0)), 30);
        assert_eq!(cadence_days("high", Some(-1)), 30);
    }

    #[test]
    fn schedule_inserts_one_reminder_per_contact() {
        let conn = setup();
        insert_contact(&conn, "c1", "high", Some("2026-08-21T10:00:00.000Z"), None);

        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Reminder WHERE contact_id = 'c1' AND kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn trigger_at_is_last_interaction_plus_cadence_days() {
        let conn = setup();
        insert_contact(&conn, "c1", "medium", Some("2026-08-01T00:00:00.000Z"), None);

        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();

        let trigger_at: String = conn
            .query_row(
                "SELECT trigger_at FROM Reminder WHERE contact_id = 'c1' AND kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // medium cadence = 90 days; 2026-08-01 + 90d = 2026-10-30
        assert_eq!(trigger_at, "2026-10-30T00:00:00.000Z");
    }

    #[test]
    fn override_cadence_is_used() {
        let conn = setup();
        insert_contact(&conn, "c1", "low", Some("2026-08-01T00:00:00.000Z"), Some(14));

        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();

        let trigger_at: String = conn
            .query_row(
                "SELECT trigger_at FROM Reminder WHERE contact_id = 'c1' AND kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(trigger_at, "2026-08-15T00:00:00.000Z");
    }

    #[test]
    fn reschedule_replaces_old_reminder() {
        let conn = setup();
        insert_contact(&conn, "c1", "high", Some("2026-08-01T00:00:00.000Z"), None);

        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Reminder WHERE contact_id = 'c1' AND kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "second call replaces the first");
    }

    #[test]
    fn contact_without_last_interaction_gets_no_reminder() {
        let conn = setup();
        insert_contact(&conn, "c1", "high", None, None);

        let tx = conn.unchecked_transaction().unwrap();
        schedule_for_contact_tx(&tx, "c1").unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Reminder WHERE contact_id = 'c1' AND kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn schedule_all_processes_every_contact() {
        let conn = setup();
        insert_contact(&conn, "c1", "high", Some("2026-08-01T00:00:00.000Z"), None);
        insert_contact(&conn, "c2", "low", Some("2026-08-01T00:00:00.000Z"), None);
        insert_contact(&conn, "c3", "high", None, None); // no last_interaction

        let n = schedule_all(&conn).unwrap();
        assert_eq!(n, 2);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM Reminder WHERE kind = 'keep_in_touch'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "c3 (no last_interaction) is skipped");
    }
}