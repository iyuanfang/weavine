//! Integration test for contact-importance cleanup.

use rusqlite::Connection;

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

#[test]
fn contact_default_importance_is_low() {
    let conn = setup();
    seed_user(&conn);
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, created_at, updated_at) \
         VALUES ('c1', 'u1', 'Alice', '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();
    let importance: String = conn
        .query_row(
            "SELECT importance FROM \"Contact\" WHERE id = 'c1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(importance, "low");
}

#[test]
fn contact_reminder_columns_are_absent() {
    let conn = setup();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('Contact') \
             WHERE name IN ('reminder_enabled', 'reminder_interval_days')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0, "reminder_* columns should be dropped");
}

#[test]
fn contact_legacy_normal_value_migrates_to_medium() {
    let conn = setup();
    seed_user(&conn);
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, created_at, updated_at) \
         VALUES ('c1', 'u1', 'Bob', '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();

    // Rebuild Contact without the CHECK constraint so a row with 'normal' can
    // be inserted, then re-run the migration which must convert it to 'medium'.
    conn.execute_batch(
        "CREATE TABLE \"Contact_legacy\" (
            \"id\" TEXT NOT NULL PRIMARY KEY,
            \"user_id\" TEXT NOT NULL REFERENCES \"User\"(\"id\") ON DELETE CASCADE,
            \"nickname\" TEXT NOT NULL,
            \"importance\" TEXT NOT NULL DEFAULT 'normal',
            \"last_contacted_at\" DATETIME,
            \"created_at\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \"updated_at\" DATETIME NOT NULL
        );
        INSERT INTO \"Contact_legacy\" (id, user_id, nickname, importance, created_at, updated_at)
            SELECT id, user_id, nickname, 'normal', created_at, updated_at FROM \"Contact\";
        DROP TABLE \"Contact\";
        ALTER TABLE \"Contact_legacy\" RENAME TO \"Contact\";",
    )
    .unwrap();

    weavine_lib::migration::run(&conn).unwrap();

    let importance: String = conn
        .query_row(
            "SELECT importance FROM \"Contact\" WHERE id = 'c1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(importance, "medium");
}

#[test]
fn contact_importance_accepts_low_medium_high() {
    let conn = setup();
    seed_user(&conn);
    for (i, value) in ["low", "medium", "high"].iter().enumerate() {
        let id = format!("c{}", i + 1);
        conn.execute(
            "INSERT INTO \"Contact\" (id, user_id, nickname, importance, created_at, updated_at) \
             VALUES (?1, 'u1', ?2, ?3, '2026-08-09', '2026-08-09')",
            rusqlite::params![id, format!("Contact {}", i + 1), value],
        )
        .unwrap();
    }
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM \"Contact\" WHERE user_id = 'u1' \
             AND importance IN ('low', 'medium', 'high')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn contact_importance_check_constraint_rejects_invalid() {
    let conn = setup();
    seed_user(&conn);
    let result = conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, importance, created_at, updated_at) \
         VALUES ('c1', 'u1', 'Bad', 'critical', '2026-08-09', '2026-08-09')",
        [],
    );
    assert!(
        result.is_err(),
        "fresh-DB CHECK constraint should reject invalid importance value"
    );
}
#[test]
fn business_create_contact_default_importance_is_low() {
    let conn = setup();
    seed_user(&conn);
    let input = weavine_lib::models::CreateContactInput {
        user_id: "u1".into(),
        nickname: "Alice".into(),
        name: Some("Alice".into()),
        company: None,
        title: None,
        city: None,
        email: None,
        phone: None,
        wechat: None,
        notes: None,
        importance: None,
        tag_ids: None,
    };

    let created = weavine_lib::business::contact::create(&conn, &input).expect("create");
    assert_eq!(created.importance, "low", "default importance must be 'low'");
}
