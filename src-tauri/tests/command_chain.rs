use serde_json::json;
use weavine_lib::commands;
use weavine_lib::db::Database;

const SCHEMA_SQL: &str = include_str!("../examples/schema_smoke.sql");

fn build_test_db() -> Database {
    let db = Database::open_memory().expect("open memory");
    {
        let conn = db.conn.lock().expect("lock");
        conn.execute_batch(SCHEMA_SQL).expect("apply schema");
        conn.execute(
            "INSERT INTO \"User\" (id, name, email, isLocal, createdAt, updatedAt) \
             VALUES ('user-local-1', 'Local User', 'local@prm.local', 1, \
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [],
        )
        .expect("seed user");
    }
    db
}

/// Replicate `State<'_, Database>` construction that Tauri normally provides
/// inline. State is a transparent wrapper over `&'r T`; tauri::State::from(&db)
/// is not pub, so we use a thin transmute that preserves lifetime.
///
/// SAFETY: db outlives state. We never mutate db and we never use state after
/// db's scope ends. The transmute reborrows `&'a Database` with the same type.
fn db_state<'a>(db: &'a Database) -> tauri::State<'a, Database> {
    let r: &'a Database = db;
    unsafe { std::mem::transmute(r) }
}

#[test]
fn contact_crud_roundtrip() {
    let db = build_test_db();

    let initial = commands::contact::list_contacts(
        db_state(&db),
        commands::params::ListContactsParams {
            owner_id: "user-local-1".to_string(),
            search: None,
            importance: None,
            tag_id: None,
        },
    )
    .expect("list initial");
    assert_eq!(initial.len(), 0, "no contacts yet");

    let created = commands::contact::create_contact(
        db_state(&db),
        commands::params::CreateContactInput {
            owner_id: "user-local-1".to_string(),
            nickname: "张三".to_string(),
            name: Some("Zhang San".to_string()),
            company: Some("ACME".to_string()),
            title: None,
            city: Some("Beijing".to_string()),
            email: None,
            phone: Some("13800000000".to_string()),
            wechat: None,
            notes: None,
            importance: Some("important".to_string()),
            tag_ids: None,
        },
    )
    .expect("create");
    assert_eq!(created.nickname, "张三");

    let fetched = commands::contact::get_contact(db_state(&db), created.id.clone())
        .expect("get");
    assert_eq!(fetched.id, created.id);

    let updated = commands::contact::update_contact(
        db_state(&db),
        commands::params::UpdateContactInput {
            id: created.id.clone(),
            nickname: Some("张三丰".to_string()),
            name: None,
            company: None,
            title: None,
            city: None,
            email: None,
            phone: None,
            wechat: None,
            notes: None,
            importance: None,
            tag_ids: None,
        },
    )
    .expect("update");
    assert_eq!(updated.nickname, "张三丰");

    let after = commands::contact::list_contacts(
        db_state(&db),
        commands::params::ListContactsParams {
            owner_id: "user-local-1".to_string(),
            search: None,
            importance: None,
            tag_id: None,
        },
    )
    .expect("list after");
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].nickname, "张三丰");

    commands::contact::delete_contact(db_state(&db), created.id.clone()).expect("delete");

    let final_state = commands::contact::list_contacts(
        db_state(&db),
        commands::params::ListContactsParams {
            owner_id: "user-local-1".to_string(),
            search: None,
            importance: None,
            tag_id: None,
        },
    )
    .expect("list final");
    assert_eq!(final_state.len(), 0);

    println!("✅ contact_crud_roundtrip passed");
}

/// Sanity check: invoke-style JSON payload for `list_contacts` deserializes
/// into the same struct Shape that Tauri would pass to the command.
#[test]
fn serde_shape_matches_invoke_payload() {
    let payload = json!({
        "p": {
            "owner_id": "user-local-1",
            "search": null,
            "importance": null,
            "tag_id": null,
        }
    });

    let p: commands::params::ListContactsParams =
        serde_json::from_value(payload["p"].clone()).expect("snake_case deser");
    assert_eq!(p.owner_id, "user-local-1");

    let create_payload = json!({
        "input": {
            "owner_id": "user-local-1",
            "nickname": "李四",
            "importance": "normal",
        }
    });
    let input: commands::params::CreateContactInput =
        serde_json::from_value(create_payload["input"].clone()).expect("create deser");
    assert_eq!(input.nickname, "李四");

    println!("✅ serde_shape_matches_invoke_payload passed");
}

#[test]
fn parameter_inspection() {
    use weavine_lib::models as m;
    let _: m::ListContactsParams = serde_json::from_value(json!({
        "owner_id": "x",
        "tag_id": "t1",
        "search": "abc",
        "importance": "important",
    }))
    .expect("ListContactsParams deser");

    let _: m::CreateContactInput = serde_json::from_value(json!({
        "owner_id": "x",
        "nickname": "n",
    }))
    .expect("CreateContactInput deser");
}

/// Smoke: the DB module has no compile-time dependency on Tauri runtime.
#[test]
fn db_decoupled_from_tauri() {
    let db = Database::open_memory().expect("memory");
    let conn = db.conn.lock().expect("lock");
    conn.execute_batch("SELECT 1").expect("trivial query");
    println!("✅ db_decoupled_from_tauri passed");
}

// Reference: tag command listing to confirm commands::params re-export.
#[test]
fn tag_list_works() {
    let db = build_test_db();
    let tags = commands::tag::list_tags(db_state(&db), "user-local-1".to_string())
        .expect("list tags");
    assert_eq!(tags.len(), 0);
    println!("✅ tag_list_works passed");
}

// Reference: ensure params module exports work — they're re-exported via
// `weavine_lib::commands::params::*` (added by refactor).
#[test]
fn _params_smoke_test() {
    let _: commands::params::ListContactsParams = serde_json::from_str(
        r#"{"owner_id":"o","tag_id":null,"search":null,"importance":null}"#,
    )
    .expect("params round-trip");
}

#[test]
fn search_invocation_shape() {
    let db = build_test_db();
    let r = commands::search::search(
        db_state(&db),
        "user-local-1".to_string(),
        "".to_string(),
        None,
    );
    assert!(r.is_ok(), "search call shape compiles + runs against empty db");
}
