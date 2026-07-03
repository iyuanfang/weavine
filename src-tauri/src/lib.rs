pub mod boot_log;
pub mod business;
pub mod commands;
pub mod db;
pub mod migration;
pub mod models;
pub mod notifier;
pub mod scheduler;
pub mod tag_color;

use commands::{action, contact, diagnostic, event, interaction, reminder, search, setting, tag};
use db::Database;
use std::fs;

use std::sync::OnceLock;

static STARTUP_ERROR: OnceLock<String> = OnceLock::new();

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
            diagnostic::get_local_user,
        ])
        .setup(|app| {
            crate::scheduler::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn dirs_data_dir_fallback() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.weavine.prm")
}