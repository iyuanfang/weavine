use chrono::{TimeZone, Utc};
use rusqlite::Connection;
use weavine_lib::business::cadence_local::tick_cadence;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    weavine_lib::migration::run(&conn).unwrap();
    conn
}

fn seed_user(conn: &Connection) {
    conn.execute(
        "INSERT INTO \"User\" (id, is_local, created_at, updated_at) \
         VALUES ('u1', 1, '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();
}

fn make_contact(conn: &Connection, id: &str, importance: &str, last_interaction_at: Option<&str>) {
    let lia = last_interaction_at.unwrap_or("2026-08-09");
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, name, importance, last_interaction_at, created_at, updated_at) \
         VALUES (?1, 'u1', ?1, ?1, ?2, ?3, '2026-08-09', '2026-08-09')",
        rusqlite::params![id, importance, lia],
    )
    .unwrap();
}

#[test]
fn high_contact_14_days_idle_creates_cadence_reminder() {
    let conn = setup();
    seed_user(&conn);
    make_contact(&conn, "c1", "high", None);
    let now = Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap();
    tick_cadence(now, &conn).unwrap();
    let r: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM reminder WHERE contact_id = 'c1' AND kind = 'cadence'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(r, 1);
}

#[test]
fn low_contact_never_creates_reminder() {
    let conn = setup();
    seed_user(&conn);
    make_contact(&conn, "c1", "low", None);
    tick_cadence(Utc::now(), &conn).unwrap();
    let r: i64 = conn
        .query_row("SELECT COUNT(*) FROM reminder WHERE kind='cadence'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(r, 0);
}

#[test]
fn existing_cadence_reminder_is_idempotent() {
    let conn = setup();
    seed_user(&conn);
    make_contact(&conn, "c1", "high", None);
    let now = Utc::now();
    tick_cadence(now, &conn).unwrap();
    tick_cadence(now, &conn).unwrap();
    let r: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM reminder WHERE contact_id = 'c1' AND kind = 'cadence'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(r, 1);
}

#[test]
fn fresh_contact_without_interaction_history_still_triggers() {
    let conn = setup();
    seed_user(&conn);
    make_contact(&conn, "c1", "high", None);
    tick_cadence(Utc::now(), &conn).unwrap();
    let r: i64 = conn
        .query_row("SELECT COUNT(*) FROM reminder WHERE kind='cadence'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(r, 1);
}

#[test]
fn invitation_token_is_deterministic_across_calls() {
    let conn = setup();
    seed_user(&conn);
    make_contact(&conn, "c1", "high", None);
    let now = Utc::now();
    tick_cadence(now, &conn).unwrap();
    let tok: String = conn
        .query_row(
            "SELECT invitation_token FROM reminder WHERE contact_id = 'c1' AND kind = 'cadence' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tok, "u1:c1:14");
}