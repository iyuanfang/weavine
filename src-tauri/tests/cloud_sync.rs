//! Integration test: cloud sync login + initial pull.
//!
//! Verifies that sync::link can POST to a weavine server, store JWT in
//! SyncState, and pull remote data into local SQLite.
//!
//! Run against the local dev server (weavine-server on :3000). Test creds
//! are the same as /tmp/auth.json (test-1783238600@local / testpass123).
//!
//! Known issue: the second `sync_once` push trips a translate bug
//! (`invalid input syntax for type boolean: ""`) when re-pushing seed rows.
//! This test exercises the login + pull half, which DOES work end-to-end.
//! See TODO in src-tauri/src/sync/translate.rs for the boolean fix.

use rusqlite::Connection;
use std::path::Path;
use weavine_lib::sync;

const TEST_DB: &str = "/tmp/test-cloud-sync.db";
const SERVER_URL: &str = "http://127.0.0.1:3000";
const TEST_EMAIL: &str = "test-1783238600@local";
const TEST_PASSWORD: &str = "testpass123";

fn setup() -> Connection {
    if Path::new(TEST_DB).exists() {
        let conn = Connection::open(TEST_DB).expect("open existing test db");
        let _ = conn.execute_batch(
            "DELETE FROM SyncState;
             DELETE FROM Tag;
             DELETE FROM \"User\" WHERE is_local = 1;
             INSERT INTO \"User\" (id, name, email, is_local, created_at, updated_at)
               VALUES ('local-default', 'Local', 'local@prm.local', 1,
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
        );
        return conn;
    }
    panic!("test db not found at {TEST_DB} — copy dev.db there first");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cloud_login_and_pull() {
    let conn = setup();

    let pre_linked = sync::config::is_linked(&conn).expect("is_linked");
    assert!(!pre_linked, "must start unlinked");

    let link_result = sync::link(&conn, SERVER_URL, TEST_EMAIL, TEST_PASSWORD)
        .await
        .expect("sync::link should succeed with valid creds");
    println!(
        "link result: pushed={}, pulled={}, conflicts={}",
        link_result.pushed, link_result.pulled, link_result.conflicts
    );
    assert!(link_result.pulled > 0, "expected to pull rows from server");

    let post_linked = sync::config::is_linked(&conn).expect("is_linked");
    assert!(post_linked, "should be linked after sync::link");

    let user_id = sync::config::get(&conn, sync::config::KEY_USER_ID)
        .expect("get user_id")
        .expect("user_id should be set");
    println!("cloud user_id: {user_id}");

    let email = sync::config::get(&conn, sync::config::KEY_USER_EMAIL)
        .expect("get email")
        .expect("email should be set");
    assert_eq!(email, TEST_EMAIL);

    let contact_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM \"Contact\"", [], |r| r.get(0))
        .expect("count contacts");
    println!("After pull — Contact: {contact_count}");
    assert!(contact_count > 0, "expected pulled contacts");

    use weavine_lib::commands::sync as cmd;
    use weavine_lib::db::Database;

    let db = Database {
        conn: std::sync::Mutex::new(conn),
    };
    // SAFETY: tauri::State<'_, Database> is a transparent newtype over &'_ Database.
    // We reborrow with the same lifetime; db outlives the state reference.
    let state: tauri::State<'_, Database> = unsafe {
        let r: &Database = &db;
        std::mem::transmute(r)
    };

    let status = cmd::cloud_status(state).expect("cloud_status");
    assert!(status.linked, "cloud_status should report linked=true");
    assert_eq!(status.user_email.as_deref(), Some(TEST_EMAIL));
    assert_eq!(status.server_url.as_deref(), Some(SERVER_URL));
    println!(
        "cloud_status: linked={}, email={:?}, last_pulled={}, last_pushed={}",
        status.linked, status.user_email, status.last_pulled_revision, status.last_pushed_revision
    );

    println!("✓ cloud_login_and_pull passed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cloud_logout_clears_state() {
    let conn = setup();
    sync::config::clear_all(&conn).expect("clear_all");
    let post = sync::config::is_linked(&conn).expect("is_linked");
    assert!(!post, "should be unlinked after clear_all");
    println!("✓ cloud_logout_clears_state passed");
}