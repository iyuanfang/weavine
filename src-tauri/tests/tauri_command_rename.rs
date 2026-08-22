//! Runtime verification that `#[tauri::command(rename_all = "snake_case")]`
//! on the 10 flat-arg commands actually accepts snake_case payloads from the
//! web-spa.
//!
//! Background: web-spa calls `invoke('list_tags', { user_id: ... })` etc.
//! with snake_case keys. Tauri v2's default is `rename_all = "camelCase"`,
//! which would reject snake_case. The fix adds `rename_all = "snake_case"`
//! to those 10 commands.
//!
//! This test exercises the Tauri command IPC layer (not the underlying Rust
//! function directly), so it actually validates the macro's deserialization
//! behavior — closing the test gap that allowed the bug to ship.

use serde_json::json;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow};
use weavine_lib::db::Database;
use weavine_lib::migration;

/// Build an in-memory DB with schema applied + a seeded local user that
/// matches what the runtime `weavine` binary would create on first boot.
fn fresh_db() -> Database {
    let db = Database::open_memory().expect("open memory");
    {
        let conn = db.conn.lock().expect("lock");
        migration::run(&conn).expect("apply schema");
        // Seed the local user (same shape as `commands::diagnostic::get_local_user`
        // would expect in production).
        conn.execute(
            "INSERT OR IGNORE INTO \"User\" \
             (id, name, email, is_local, created_at, updated_at) \
             VALUES ('local-default', '本地用户', 'local@weavine.app', 1, \
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            [],
        )
        .expect("seed user");
    }
    db
}

/// Construct an `InvokeRequest` matching the official Tauri test example
/// (`tauri::test::assert_ipc_response`). `callback`/`error` are unused callback
/// table indices; any unique numbers work since we never read the response
/// channel back.
fn build_invoke_request(cmd: &str, params: serde_json::Value) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .expect("parse URL"),
        body: InvokeBody::Json(params),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_string(),
    }
}

/// Helper: invoke a Tauri command via the IPC layer with a snake_case
/// payload, mimicking exactly what web-spa's `invoke('list_tags', { user_id })`
/// sends. Asserts no error. Limited to MockRuntime because `get_ipc_response`
/// is part of `tauri::test` and only implements for that runtime.
fn assert_snake_case_accepted(
    app: &tauri::App<tauri::test::MockRuntime>,
    command: &str,
    payload: serde_json::Value,
) {
    let request = build_invoke_request(command, payload.clone());
    let window: WebviewWindow<tauri::test::MockRuntime> = app
        .get_webview_window("main")
        .expect("main webview window must exist");
    let response = tauri::test::get_ipc_response(&window, request);
    match response {
        Ok(body) => {
            eprintln!("  [OK] {command}({payload}) → {body:?}");
        }
        Err(e) => {
            panic!(
                "✗ {command}({payload}) was REJECTED by the Tauri command layer \
                 (snake_case fix not working?). Error: {e:?}\n\
                 → This means the rename_all=\"snake_case\" attribute is not \
                 taking effect, OR the macro-generated wrapper is using camelCase.",
            );
        }
    }
}

#[test]
fn list_tags_accepts_snake_case_user_id() {
    let db = fresh_db();
    let app = tauri::test::mock_builder()
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            weavine_lib::commands::tag::list_tags,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("about:blank".into()),
    )
    .build()
    .expect("build webview window");

    // EXACT payload web-spa sends: `{ user_id: "..." }` in snake_case.
    assert_snake_case_accepted(
        &app,
        "list_tags",
        json!({ "user_id": "local-default" }),
    );
}

#[test]
fn list_actions_accepts_snake_case_filter_args() {
    let db = fresh_db();
    let app = tauri::test::mock_builder()
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            weavine_lib::commands::action::list_actions,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("about:blank".into()),
    )
    .build()
    .expect("build webview window");

    // Snake_case across the full arg list — same shape as web-spa's
    // adapter/tauri.ts builds.
    assert_snake_case_accepted(
        &app,
        "list_actions",
        json!({
            "user_id": "local-default",
            "status": null,
            "priority": null,
            "category": null,
            "contact_id": null,
            "tag_id": null,
            "search": null,
        }),
    );
}

#[test]
fn list_settings_upsert_delete_accept_snake_case() {
    let db = fresh_db();
    let app = tauri::test::mock_builder()
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            weavine_lib::commands::setting::list_settings,
            weavine_lib::commands::setting::upsert_setting,
            weavine_lib::commands::setting::delete_setting,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("about:blank".into()),
    )
    .build()
    .expect("build webview window");

    assert_snake_case_accepted(
        &app,
        "list_settings",
        json!({ "user_id": "local-default" }),
    );
    assert_snake_case_accepted(
        &app,
        "upsert_setting",
        json!({
            "user_id": "local-default",
            "key": "theme",
            "value": "dark",
        }),
    );
    assert_snake_case_accepted(
        &app,
        "delete_setting",
        json!({
            "user_id": "local-default",
            "key": "theme",
        }),
    );
}

#[test]
fn search_accepts_snake_case() {
    let db = fresh_db();
    let app = tauri::test::mock_builder()
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            weavine_lib::commands::search::search,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("about:blank".into()),
    )
    .build()
    .expect("build webview window");

    assert_snake_case_accepted(
        &app,
        "search",
        json!({
            "user_id": "local-default",
            "query": "",
            "limit": null,
            "include_archived": null,
        }),
    );
}

#[test]
fn list_events_list_interactions_list_reminders_accept_snake_case() {
    let db = fresh_db();
    let app = tauri::test::mock_builder()
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            weavine_lib::commands::event::list_events,
            weavine_lib::commands::event::get_upcoming_events,
            weavine_lib::commands::interaction::list_interactions,
            weavine_lib::commands::reminder::list_reminders,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::App("about:blank".into()),
    )
    .build()
    .expect("build webview window");

    assert_snake_case_accepted(
        &app,
        "list_events",
        json!({ "user_id": "local-default", "from": null, "to": null }),
    );
    assert_snake_case_accepted(
        &app,
        "get_upcoming_events",
        json!({ "user_id": "local-default", "days": 7 }),
    );
    assert_snake_case_accepted(
        &app,
        "list_interactions",
        json!({ "user_id": "local-default", "contact_id": null }),
    );
    assert_snake_case_accepted(
        &app,
        "list_reminders",
        json!({ "user_id": "local-default", "include_dismissed": null }),
    );
}