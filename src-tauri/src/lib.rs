pub mod commands;
pub mod db;
pub mod models;

use commands::{action, contact, diagnostic, event, interaction, reminder, search, setting, tag};
use tauri::{Emitter, Manager};
use db::Database;
use std::fs;
use std::process::Child;
use std::sync::Mutex;

pub struct ServerProcess(pub Mutex<Option<Child>>);

pub mod spawner;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use serde::Serialize;

static STARTUP_ERROR: OnceLock<String> = OnceLock::new();
static SERVER_READY: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
struct ServerStatusPayload {
    status: String,
    message: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(database)
        .manage(ServerProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            contact::list_contacts,
            contact::create_contact,
            contact::update_contact,
            contact::delete_contact,
            contact::get_contact,
            interaction::list_interactions,
            interaction::create_interaction,
            interaction::update_interaction,
            interaction::delete_interaction,
            interaction::get_interaction,
            event::list_events,
            event::create_event,
            event::update_event,
            event::delete_event,
            event::get_event,
            event::get_upcoming_events,
            action::list_actions,
            action::create_action,
            action::update_action,
            action::delete_action,
            action::get_action,
            reminder::list_reminders,
            reminder::create_reminder,
            reminder::update_reminder,
            reminder::delete_reminder,
            reminder::dismiss_reminder,
            tag::list_tags,
            tag::create_tag,
            tag::update_tag,
            tag::delete_tag,
            setting::list_settings,
            setting::upsert_setting,
            setting::delete_setting,
            search::search,
            diagnostic::get_startup_info,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let server_state = handle.state::<ServerProcess>();

            if std::env::var("TAURI_DEV").is_err() {
                let resource_dir = handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
                let data_dir = handle
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());

                let _ = handle.emit("server-status", ServerStatusPayload {
                    status: "starting".into(),
                    message: "正在启动后端服务...".into(),
                });

                match spawn_standalone_server(&resource_dir, &data_dir, &server_state) {
                    Ok(child) => {
                        SERVER_READY.store(true, Ordering::SeqCst);
                        *server_state.0.lock().unwrap() = Some(child);
                        let _ = handle.emit("server-status", ServerStatusPayload {
                            status: "ready".into(),
                            message: String::new(),
                        });
                    }
                    Err(e) => {
                        let err_str = e.to_string();
                        STARTUP_ERROR.set(err_str.clone()).ok();
                        eprintln!("[weavine] Failed to spawn Next.js server: {err_str}");
                        let _ = handle.emit("server-status", ServerStatusPayload {
                            status: "error".into(),
                            message: err_str,
                        });
                        let _ = fs::create_dir_all(&data_dir);
                        let _ = fs::write(data_dir.join("startup-error.log"), &e);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<ServerProcess>();
                let child = state.0.lock().unwrap().take();
                if let Some(mut child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_standalone_server(
    resource_dir: &std::path::Path,
    data_dir: &std::path::Path,
    _state: &tauri::State<ServerProcess>,
) -> Result<Child, String> {
    spawner::spawn(
        resource_dir,
        data_dir,
        spawner::SERVER_PORT,
        spawner::SERVER_HOST,
        spawner::SERVER_STARTUP_TIMEOUT_SECS,
    )
}