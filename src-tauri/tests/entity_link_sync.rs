//! Integration test for entity_link local CRUD + sync translate round-trip.

use rusqlite::Connection;
use weavine_lib::sync::translate;

fn setup() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    weavine_lib::migration::run(&conn).unwrap();
    conn
}

fn seed_user_contact_event(conn: &Connection) {
    conn.execute(
        "INSERT INTO \"User\" (id, is_local, created_at, updated_at) \
         VALUES ('u1', 1, '2026-08-01', '2026-08-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO \"Contact\" (id, user_id, nickname, created_at, updated_at) \
         VALUES ('c1', 'u1', 'Alice', '2026-08-01', '2026-08-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO \"Event\" (id, user_id, title, event_type, start_at, created_at, updated_at) \
         VALUES ('e1', 'u1', 'Demo', 'event', '2026-08-01 10:00:00', '2026-08-01', '2026-08-01')",
        [],
    ).unwrap();
}

#[test]
fn push_columns_registered_for_entity_link() {
    let cols = translate::push_columns("entity_link");
    assert_eq!(cols.len(), 10);
    assert!(cols.contains(&"id"));
    assert!(cols.contains(&"user_id"));
    assert!(cols.contains(&"from_type"));
    assert!(cols.contains(&"to_id"));
    assert!(cols.contains(&"relation_type"));
    assert!(cols.contains(&"role"));
    assert!(cols.contains(&"label"));
    assert!(cols.contains(&"created_at"));
}

#[test]
fn entity_link_round_trip_via_business() {
    let conn = setup();
    seed_user_contact_event(&conn);

    let link = weavine_lib::business::event_participant::add(&conn, "e1", "c1", "organizer")
        .expect("add participant");
    assert_eq!(link.relation_type, "participated");
    assert_eq!(link.role, "organizer");
    assert_eq!(link.from_type, "event");
    assert_eq!(link.from_id, "e1");
    assert_eq!(link.to_type, "contact");
    assert_eq!(link.to_id, "c1");
    assert_eq!(link.user_id, "u1");

    let list = weavine_lib::business::event_participant::list(&conn, "e1", "u1")
        .expect("list participants");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, link.id);

    weavine_lib::business::event_participant::set_role(&conn, "e1", "c1", "mentioned", "u1")
        .expect("set role");
    let list = weavine_lib::business::event_participant::list(&conn, "e1", "u1").unwrap();
    assert_eq!(list[0].role, "mentioned");

    weavine_lib::business::event_participant::remove(&conn, "e1", "c1", "u1").expect("remove");
    let list = weavine_lib::business::event_participant::list(&conn, "e1", "u1").unwrap();
    assert!(list.is_empty());
}

#[test]
fn sync_main_participant_keeps_event_contact_id_in_sync() {
    let conn = setup();
    seed_user_contact_event(&conn);

    weavine_lib::business::event_participant::add(&conn, "e1", "c1", "organizer").unwrap();
    let main: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM \"Event\" WHERE id = 'e1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(main.as_deref(), Some("c1"));

    weavine_lib::business::event_participant::remove(&conn, "e1", "c1", "u1").unwrap();
    let main: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM \"Event\" WHERE id = 'e1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(main, None);
}

#[test]
fn upsert_idempotent_via_unique_constraint() {
    let conn = setup();
    seed_user_contact_event(&conn);

    weavine_lib::business::event_participant::add(&conn, "e1", "c1", "organizer").unwrap();
    weavine_lib::business::event_participant::add(&conn, "e1", "c1", "participant").unwrap();

    let list = weavine_lib::business::event_participant::list(&conn, "e1", "u1").unwrap();
    assert_eq!(list.len(), 1, "duplicate UNIQUE constraint must collapse");
    assert_eq!(list[0].role, "participant", "second add should overwrite role");
}

#[test]
fn invalid_role_falls_back_to_participant() {
    let conn = setup();
    seed_user_contact_event(&conn);
    let link = weavine_lib::business::event_participant::add(&conn, "e1", "c1", "bogus").unwrap();
    assert_eq!(link.role, "participant");
}