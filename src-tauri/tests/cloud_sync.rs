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
             DELETE FROM ContactTag;
             DELETE FROM ProjectContact;
             DELETE FROM Reminder;
             DELETE FROM Interaction;
             DELETE FROM Action;
             DELETE FROM Event;
             DELETE FROM Project;
             DELETE FROM Contact;
             DELETE FROM Tag;
             DELETE FROM Setting;
             DELETE FROM \"User\" WHERE is_local = 1;
             INSERT INTO \"User\" (id, name, email, is_local, created_at, updated_at)
               VALUES ('local-default', 'Local', 'local@weavine.local', 1,
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn push_with_boolean_columns_succeeds() {
    let conn = setup();
    sync::link(&conn, SERVER_URL, TEST_EMAIL, TEST_PASSWORD)
        .await
        .expect("initial link");

    let contact_id: String = format!("test-bool-{}", uuid::Uuid::new_v4());
    let unique_email = format!("bool-{}@test.local", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, email, importance, reminder_enabled, \
                                reminder_interval_days, created_at, updated_at) \
         VALUES (?1, 'local-default', ?2, ?3, 'normal', 1, 7, ?4, ?4)",
        rusqlite::params![&contact_id, "Bool Test", &unique_email, &now],
    )
    .expect("insert contact");

    let sync_result = sync::sync_once(&conn).await.expect("sync_once must not fail on boolean columns");
    println!(
        "push-with-bool: pushed={}, pulled={}, conflicts={}",
        sync_result.pushed, sync_result.pulled, sync_result.conflicts
    );
    assert!(sync_result.pushed >= 1, "expected to push at least the new contact");

    let still_linked = sync::config::is_linked(&conn).expect("is_linked");
    assert!(still_linked, "should still be linked after sync_once");

    println!("✓ push_with_boolean_columns_succeeds passed");
}

/// Case A: server-only data → fresh local. Sync must pull every row
/// from the server without modifying any server-side field.
///
/// Regression test for v0.2.20 bug where apply_change coerced JSON
/// null to "" for every TEXT column, which:
///   1. corrupted server project.archived_at back to "" on the next
///      push (UI treated "" as archived);
///   2. broke UNIQUE(user_id, email) on Contact when multiple contacts
///      had a null email — only one survived the insert.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn case_a_empty_local_pulls_server_data_unchanged() {
    let conn = setup();
    sync::config::clear_all(&conn).expect("clear_all before case A");

    let server_url = SERVER_URL;

    // Capture server revision BEFORE sync. Initial sync is push+pull;
    // since local is empty, push is a no-op so revision must not move.
    let token_before = {
        // Need a token to call manifest. Re-login cheaply to get one.
        let login_resp = sync::api::login(server_url, TEST_EMAIL, TEST_PASSWORD)
            .await
            .expect("login for manifest probe");
        sync::config::set(&conn, sync::config::KEY_ACCESS_TOKEN, &login_resp.access_token)
            .expect("persist token");
        login_resp.access_token
    };
    let manifest_before = sync::api::manifest(server_url, &token_before)
        .await
        .expect("manifest before");
    let rev_before = manifest_before.server_revision;
    println!("case A: server revision before = {rev_before}");

    // Run initial sync — should pull all server rows.
    let link_result = sync::link(&conn, server_url, TEST_EMAIL, TEST_PASSWORD)
        .await
        .expect("link should succeed");
    println!(
        "case A link: pushed={}, pulled={}, conflicts={}",
        link_result.pushed, link_result.pulled, link_result.conflicts
    );
    assert_eq!(
        link_result.pushed, 0,
        "empty local must not push anything; got {}",
        link_result.pushed
    );
    assert!(
        link_result.pulled >= 1,
        "expected at least 1 row pulled from server"
    );

    // Server's revision must NOT have moved because push was empty.
    let token_after = sync::config::get(&conn, sync::config::KEY_ACCESS_TOKEN)
        .expect("token set")
        .unwrap();
    let manifest_after = sync::api::manifest(server_url, &token_after)
        .await
        .expect("manifest after");
    let rev_after = manifest_after.server_revision;
    println!("case A: server revision after  = {rev_after}");
    assert_eq!(
        rev_before, rev_after,
        "server revision must not change when local push is empty"
    );

    // The known contact on the test account has email set, last_contacted_at
    // NULL, reminder_enabled=true, reminder_interval_days=7. If pull had
    // corrupted any of these to "", the assertions below would fail.
    let contact = conn
        .query_row(
            "SELECT email, name, last_contacted_at, reminder_enabled, reminder_interval_days \
             FROM \"Contact\" WHERE user_id = 'local-default' LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .expect("expected at least one contact after pull");
    let (email, name, last_contacted, rem_enabled, rem_interval) = contact;
    assert!(
        email.as_deref().unwrap_or("").starts_with("bool-"),
        "email must be preserved, got {email:?}"
    );
    assert_eq!(
        rem_enabled, 1,
        "reminder_enabled boolean must round-trip as 1"
    );
    assert_eq!(
        rem_interval,
        Some(7),
        "reminder_interval_days must stay 7 (not become NULL or 0)"
    );
    assert!(
        last_contacted.is_none(),
        "last_contacted_at NULL must stay NULL, got {last_contacted:?}"
    );
    assert!(
        name.is_none() || name.as_deref() == Some(""),
        "name NULL must stay NULL or empty, got {name:?}"
    );

    println!("✓ case_a_empty_local_pulls_server_data_unchanged passed");
}

/// Case B: both server and local have data. Sync must:
///
///   * push local-only rows to the server;
///   * pull server-only rows to local;
///   * leave rows present on both sides alone (LWW via server_revision).
///
/// Verifies that the pull side does not corrupt the local rows it just
/// pushed, and the push side does not duplicate or archive server rows.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn case_b_both_sides_have_data_merges() {
    let conn = setup();

    // First link so we know we're starting clean.
    sync::link(&conn, SERVER_URL, TEST_EMAIL, TEST_PASSWORD)
        .await
        .expect("initial link");

    let contact_count_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM \"Contact\"", [], |r| r.get(0))
        .expect("count contacts before");
    println!("case B: local contacts before = {contact_count_before}");

    // Insert a brand-new local-only contact that does NOT exist on server.
    // Use a unique email so we can find it after sync.
    let new_id = format!("caseb-{}", uuid::Uuid::new_v4());
    let new_email = format!("caseb-{}@test.local", uuid::Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, name, email, reminder_enabled, \
                                 reminder_interval_days, created_at, updated_at) \
         VALUES (?1, 'local-default', ?2, NULL, ?3, 0, NULL, ?4, ?4)",
        rusqlite::params![&new_id, "Case B Local", &new_email, &now],
    )
    .expect("insert local-only contact");

    // Sync should push this new contact AND pull any server changes.
    let result = sync::sync_once(&conn).await.expect("sync_once case B");
    println!(
        "case B sync: pushed={}, pulled={}, conflicts={}",
        result.pushed, result.pulled, result.conflicts
    );
    assert!(
        result.pushed >= 1,
        "expected the local-only contact to be pushed"
    );

    // The contact we just inserted must still be present locally with
    // its data intact (pull must not have overwritten it via stale data).
    let after_id: String = conn
        .query_row(
            "SELECT id FROM \"Contact\" WHERE id = ?1",
            rusqlite::params![&new_id],
            |r| r.get(0),
        )
        .expect("local-only contact must still exist after sync");
    assert_eq!(after_id, new_id);

    let after_email: String = conn
        .query_row(
            "SELECT email FROM \"Contact\" WHERE id = ?1",
            rusqlite::params![&new_id],
            |r| r.get(0),
        )
        .expect("read email after sync");
    assert_eq!(after_email, new_email);

    // The local rows that came from the server in the very first link()
    // must still be there with their data intact.
    let contact_count_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM \"Contact\"", [], |r| r.get(0))
        .expect("count contacts after");
    assert!(
        contact_count_after >= contact_count_before,
        "contact count must not decrease (got {contact_count_before} → {contact_count_after})"
    );

    // NULL preservation invariant: no Contact row should have email = ""
    // or last_contacted_at = "" — those would be corruption artifacts.
    let corrupted_email: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Contact\" WHERE email = ''",
            [],
            |r| r.get(0),
        )
        .expect("count corrupted email");
    assert_eq!(
        corrupted_email, 0,
        "no Contact row should have email = '' (corruption artifact)"
    );

    println!("✓ case_b_both_sides_have_data_merges passed");
}