//! Unit tests for `business::reminder::claim_due_reminders`.
//!
//! Covers the scheduler's atomic claim:
//!   - "due" means `trigger_at <= now AND dispatched = 0 AND dismissed = 0`
//!   - claiming flips `dispatched = 1` so the next call skips the row
//!   - dismissed / already-dispatched / future rows are never claimed

use chrono::Duration;
use rusqlite::Connection;
use weavine_lib::business::reminder::claim_due_reminders;
use weavine_lib::migration;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    migration::run(&conn).unwrap();
    conn
}

fn seed_user(conn: &Connection) {
    conn.execute(
        "INSERT INTO \"User\" (id, is_local, created_at, updated_at) \
         VALUES ('u1', 1, '2026-08-21', '2026-08-21')",
        [],
    )
    .unwrap();
}

/// Insert a Reminder with a trigger_at offset from "now". Negative offset =
/// in the past (already due). Positive offset = in the future (not due).
fn insert_reminder(
    conn: &Connection,
    id: &str,
    trigger_offset_secs: i64,
    dispatched: bool,
    dismissed: bool,
) {
    let trigger_at = (chrono::Utc::now() + Duration::seconds(trigger_offset_secs))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    conn.execute(
        "INSERT INTO \"Reminder\" (id, user_id, trigger_at, kind, dispatched, dismissed, created_at) \
         VALUES (?1, 'u1', ?2, 'time', ?3, ?4, '2026-08-21T00:00:00Z')",
        rusqlite::params![id, trigger_at, dispatched as i64, dismissed as i64],
    )
    .unwrap();
}

#[test]
fn claims_due_reminder_and_marks_dispatched() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-due", -60, false, false);

    let claimed = claim_due_reminders(&conn).unwrap();

    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, "r-due");

    let disp: i64 = conn
        .query_row("SELECT dispatched FROM \"Reminder\" WHERE id = 'r-due'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(disp, 1, "DB row must be flipped to dispatched=1");
}

#[test]
fn skips_future_reminder() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-future", 3600, false, false);

    let claimed = claim_due_reminders(&conn).unwrap();

    assert!(claimed.is_empty(), "future row must not be claimed");

    let disp: i64 = conn
        .query_row("SELECT dispatched FROM \"Reminder\" WHERE id = 'r-future'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(disp, 0, "future row must not be flipped");
}

#[test]
fn skips_dismissed_reminder() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-dismissed", -60, false, true);

    let claimed = claim_due_reminders(&conn).unwrap();

    assert!(claimed.is_empty(), "dismissed row must not be claimed");

    let disp: i64 = conn
        .query_row(
            "SELECT dispatched FROM \"Reminder\" WHERE id = 'r-dismissed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(disp, 0, "dismissed row must not be flipped");
}

#[test]
fn skips_already_dispatched_reminder() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-already", -60, true, false);

    let claimed = claim_due_reminders(&conn).unwrap();

    assert!(claimed.is_empty(), "already-dispatched row must not be re-claimed");
}

#[test]
fn second_call_returns_empty_idempotent() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-once", -60, false, false);

    let first = claim_due_reminders(&conn).unwrap();
    let second = claim_due_reminders(&conn).unwrap();

    assert_eq!(first.len(), 1, "first call claims the row");
    assert!(second.is_empty(), "second call is a no-op (dispatched=1)");
}

#[test]
fn claims_only_due_non_dismissed_rows() {
    let conn = setup();
    seed_user(&conn);
    insert_reminder(&conn, "r-due-a", -60, false, false);
    insert_reminder(&conn, "r-due-b", -120, false, false);
    insert_reminder(&conn, "r-skip-future", 3600, false, false);
    insert_reminder(&conn, "r-skip-dismissed", -120, false, true);
    insert_reminder(&conn, "r-skip-already-dispatched", -120, true, false);

    let claimed = claim_due_reminders(&conn).unwrap();
    let ids: std::collections::HashSet<_> = claimed.iter().map(|r| r.id.clone()).collect();

    assert_eq!(claimed.len(), 2);
    assert!(ids.contains("r-due-a"));
    assert!(ids.contains("r-due-b"));
    assert!(!ids.contains("r-skip-future"));
    assert!(!ids.contains("r-skip-dismissed"));
    assert!(!ids.contains("r-skip-already-dispatched"));

    let claimed_dispatched_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Reminder\" WHERE id IN ('r-due-a', 'r-due-b') AND dispatched = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(claimed_dispatched_count, 2, "both claimed rows flipped");

    let others_dispatched_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Reminder\" WHERE id IN ('r-skip-future', 'r-skip-dismissed') AND dispatched = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(others_dispatched_count, 0, "skipped rows untouched");
}

#[test]
fn no_rows_returns_empty() {
    let conn = setup();
    seed_user(&conn);
    let claimed = claim_due_reminders(&conn).unwrap();
    assert!(claimed.is_empty());
}