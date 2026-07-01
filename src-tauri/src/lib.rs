pub mod boot_log;
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
    let initial_data_dir = dirs_data_dir_fallback();
    boot_log::init(&initial_data_dir);
    boot_log::log("Tauri run() invoked");

    let database = match Database::new() {
        Ok(db) => {
            boot_log::log("Database::new succeeded");
            db
        }
        Err(e) => {
            let msg = format!("Failed to initialize database: {e}");
            boot_log::log(&msg);
            eprintln!("[weavine] {msg}");
            STARTUP_ERROR.set(msg.clone()).ok();
            let _ = fs::create_dir_all(&initial_data_dir);
            let _ = fs::write(initial_data_dir.join("startup-error.log"), &msg);
            return;
        }
    };

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

                boot_log::log(&format!("resource_dir={}", resource_dir.display()));
                boot_log::log(&format!("data_dir={}", data_dir.display()));

                let _ = handle.emit("server-status", ServerStatusPayload {
                    status: "starting".into(),
                    message: "正在启动后端服务...".into(),
                });

                match spawn_standalone_server(&resource_dir, &data_dir, &server_state) {
                    Ok(child) => {
                        boot_log::log("spawn_standalone_server returned Ok");
                        SERVER_READY.store(true, Ordering::SeqCst);
                        *server_state.0.lock().unwrap() = Some(child);
                        let _ = handle.emit("server-status", ServerStatusPayload {
                            status: "ready".into(),
                            message: String::new(),
                        });
                    }
                    Err(e) => {
                        let err_str = e.to_string();
                        boot_log::log(&format!("spawn_standalone_server failed: {err_str}"));
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
                    println!("[lib] Closing window — killing server process (pid={})", child.id());
                    spawner::kill_child_with_timeout(&mut child, std::time::Duration::from_secs(3));
                    println!("[lib] Server process terminated");
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
    // Before spawning, make sure port is free — kill any stale process
    boot_log::log("Checking for stale server process on port 3199...");
    spawner::kill_process_on_port(spawner::SERVER_PORT);

    spawner::spawn(
        resource_dir,
        data_dir,
        spawner::SERVER_PORT,
        spawner::SERVER_HOST,
        spawner::SERVER_STARTUP_TIMEOUT_SECS,
    )
}

fn dirs_data_dir_fallback() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.weavine.prm")
}