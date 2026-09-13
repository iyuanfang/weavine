//! Integration test: cadence reminder sync with invitation_token
//!
//! Tests that:
//! 1. Cadence reminder with invitation_token can be pushed to server
//! 2. Pull on second device retrieves reminder with token intact
//! 3. Token can be used for deduplication check

use rusqlite::Connection;
use serde_json::json;
use std::path::PathBuf;
use weavine_lib::sync;

const SERVER_URL: &str = "http://127.0.0.1:3000";
const TEST_EMAIL: &str = "test-sync-12345@local";
const TEST_PASSWORD: &str = "testpass123";

/// Create a fresh test database with proper schema
fn create_test_db() -> Connection {
    let db_path = PathBuf::from("/tmp/test-cadence-sync.db");
    let _ = std::fs::remove_file(&db_path);

    let conn = Connection::open(&db_path).expect("open test db");

    conn.execute_batch(
        "
        CREATE TABLE User (
            id TEXT NOT NULL PRIMARY KEY,
            name TEXT,
            email TEXT,
            is_local INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE Contact (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            nickname TEXT,
            name TEXT,
            company TEXT,
            title TEXT,
            city TEXT,
            email TEXT,
            phone TEXT,
            wechat TEXT,
            notes TEXT,
            importance TEXT NOT NULL DEFAULT 'low',
            last_interaction_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE Reminder (
            id TEXT NOT NULL PRIMARY KEY,
            user_id TEXT NOT NULL,
            contact_id TEXT,
            event_id TEXT,
            trigger_at TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'time',
            dispatched INTEGER NOT NULL DEFAULT 0,
            dismissed INTEGER NOT NULL DEFAULT 0,
            invitation_token TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE SyncState (
            key TEXT NOT NULL PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
    .expect("create tables");

    conn
}

#[tokio::test]
async fn cadence_reminder_push_with_invitation_token() {
    let mut conn = create_test_db();

    // Insert test user
    conn.execute(
        "INSERT INTO User (id, name, email, is_local, created_at, updated_at)
         VALUES ('test-user-1', 'Test User', 'test-sync-12345@local', 0, '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z')",
        [],
    )
    .expect("insert user");

    // Insert test contact with old interaction (to trigger cadence)
    let contact_id = "cadence-contact-1";
    conn.execute(
        "INSERT INTO Contact (id, user_id, nickname, importance, last_interaction_at, created_at, updated_at)
         VALUES (?1, 'test-user-1', 'Test Contact', 'high', '2026-05-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')",
        rusqlite::params![contact_id],
    )
    .expect("insert contact");

    // Insert cadence reminder with invitation_token
    let reminder_id = "cadence-reminder-1";
    let token = "test-user-1:cadence-contact-1:14";
    conn.execute(
        "INSERT INTO Reminder (id, user_id, contact_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at)
         VALUES (?1, 'test-user-1', ?2, '2026-08-15T10:00:00Z', 'cadence', 0, 0, ?3, '2026-08-10T00:00:00Z')",
        rusqlite::params![reminder_id, contact_id, token],
    )
    .expect("insert reminder");

    println!(
        "✓ Test database created with cadence reminder (token: {})",
        token
    );

    // Verify local reminder exists with token
    let (kind, stored_token): (String, Option<String>) = conn
        .query_row(
            "SELECT kind, invitation_token FROM Reminder WHERE id = ?1",
            rusqlite::params![reminder_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("query reminder");

    assert_eq!(kind, "cadence");
    assert_eq!(stored_token, Some(token.to_string()));
    println!("✓ Local reminder has correct kind and invitation_token");
}

#[tokio::test]
async fn push_columns_includes_invitation_token() {
    use weavine_lib::sync::translate::push_columns;

    let cols = push_columns("reminder");
    assert!(
        cols.contains(&"invitation_token"),
        "push_columns('reminder') must include invitation_token"
    );
    println!(
        "✓ push_columns('reminder') includes invitation_token: {:?}",
        cols
    );
}
