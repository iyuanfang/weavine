use rusqlite::Connection;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    weavine_lib::migration::run(&conn).unwrap();
    conn
}

fn seed_user(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO \"User\" (id, is_local, created_at, updated_at) \
         VALUES (?1, 1, '2026-08-09', '2026-08-09')",
        rusqlite::params![id],
    )
    .unwrap();
}

#[test]
fn search_returns_contact_with_correct_importance_after_reminder_column_drop() {
    let conn = setup();
    seed_user(&conn, "u1");

    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, name, importance, notes, created_at, updated_at) \
         VALUES ('c1', 'u1', 'Ali', 'Alice', 'high', 'needle-token', '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();

    let results =
        weavine_lib::business::search::search(&conn, "u1", "needle", None, false).unwrap();
    assert_eq!(results.contacts.len(), 1, "should find exactly Alice");
    let c = &results.contacts[0];
    assert_eq!(c.name.as_deref(), Some("Alice"));
    assert_eq!(
        c.importance, "high",
        "importance must survive the SELECT round-trip (would be corrupted if reminder columns were still in the SELECT list)"
    );
    assert_eq!(c.notes.as_deref(), Some("needle-token"));
    assert!(
        !c.last_interaction_at.is_empty(),
        "last_interaction_at must be populated on a fresh contact (stamped to created_at)"
    );
}

#[test]
fn search_returns_multiple_contacts_with_distinct_importance_levels() {
    let conn = setup();
    seed_user(&conn, "u1");

    for (i, imp) in ["high", "low", "medium"].iter().enumerate() {
        conn.execute(
            "INSERT INTO \"Contact\" (id, user_id, nickname, name, importance, notes, created_at, updated_at) \
             VALUES (?1, 'u1', ?2, ?3, ?4, 'shared-token', '2026-08-09', '2026-08-09')",
            rusqlite::params![format!("c{i}"), format!("p{i}"), format!("Person {i}"), imp],
        )
        .unwrap();
    }

    let results =
        weavine_lib::business::search::search(&conn, "u1", "shared-token", None, false).unwrap();
    assert_eq!(results.contacts.len(), 3);

    let importances: Vec<&str> = results
        .contacts
        .iter()
        .map(|c| c.importance.as_str())
        .collect();
    for needed in ["high", "low", "medium"] {
        assert!(
            importances.contains(&needed),
            "importance {needed} must round-trip, got {importances:?}"
        );
    }
    for c in &results.contacts {
        assert_eq!(c.notes.as_deref(), Some("shared-token"));
    }
}

#[test]
fn project_contact_list_returns_contact_with_correct_importance() {
    let conn = setup();
    seed_user(&conn, "u1");

    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, name, importance, notes, created_at, updated_at) \
         VALUES ('c1', 'u1', 'B', 'Bob', 'medium', 'should round-trip', '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO \"Project\" (id, user_id, title, template, stage, created_at, updated_at) \
         VALUES ('p1', 'u1', 'Test', 'general', '进行中', '2026-08-09', '2026-08-09')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ProjectContact (user_id, project_id, contact_id, role, added_at) \
         VALUES ('u1', 'p1', 'c1', 'lead', '2026-08-09')",
        [],
    )
    .unwrap();

    let rows = weavine_lib::business::project_contact::list_contacts_for_project(&conn, "p1")
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].contact.name.as_deref(), Some("Bob"));
    assert_eq!(
        rows[0].contact.importance, "medium",
        "importance must survive list_contacts_for_project SELECT"
    );
    assert_eq!(rows[0].role.as_deref(), Some("lead"));
}