pub mod boot_log;
pub mod business;

#[cfg(feature = "tauri")]
pub mod commands;
pub mod db;
pub mod install_id;
pub mod migration;
pub mod models;
pub mod project_template;
pub mod quick;
pub mod sync;
pub mod tag_color;
#[cfg(feature = "voice-local")]
pub mod android_assets;
#[cfg(feature = "voice-local")]
pub mod voice_local;

#[cfg(feature = "tauri")]
use std::sync::OnceLock;

#[cfg(feature = "tauri")]
static STARTUP_ERROR: OnceLock<String> = OnceLock::new();

#[cfg(feature = "tauri")]
pub(crate) fn startup_error() -> Option<String> {
    STARTUP_ERROR.get().cloned()
}

#[cfg(not(feature = "tauri"))]
pub(crate) fn startup_error() -> Option<String> {
    None
}

/// Returns the Android app data dir name for the current build flavor.
///
/// The two Android APK flavors have different `tauri.conf.json::identifier`
/// values — `com.weavine.desktop` for the cloud flavor and
/// `com.weavine.desktop.local` for the local (on-device sherpa-onnx) flavor.
/// Android sandboxes each app's data under `/data/user/0/<identifier>/`, so
/// any code that derives the data dir from a hardcoded string MUST pick the
/// right one per flavor. Using the wrong value causes `Connection::open` to
/// fail with permission errors, the app falls back to an in-memory DB, the
/// seed user is never created, and `get_local_user` errors forever — the
/// JS UI then sticks on the "正在加载用户…" splash.
///
/// Always available (not gated to `target_os = "android"`) because
/// `dirs::data_dir().join(...)` call sites run on every target; on
/// non-Android only the cloud-flavor identifier is ever correct because
/// the `voice-local` feature is Android-only.
pub(crate) fn android_data_dir_name() -> &'static str {
    #[cfg(all(target_os = "android", feature = "voice-local"))]
    {
        "com.weavine.desktop.local"
    }
    #[cfg(not(all(target_os = "android", feature = "voice-local")))]
    {
        "com.weavine.desktop"
    }
}

#[cfg(feature = "tauri")]
fn dirs_data_dir_fallback() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(android_data_dir_name())
}

#[cfg(feature = "tauri")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use commands::{action, contact, diagnostic, event, install_id as cmd_install_id, interaction, media, ocr, project, project_contact, quick, reminder, search, setting, tag, voice};
    use db::Database;
    use std::fs;
    use tauri::{Emitter, Manager};
    // tauri-plugin-global-shortcut is desktop-only (the crate root has
    // `#![cfg(not(any(target_os = "android", target_os = "ios")))]`).
    // Import ShortcutState only on desktop so the Android build compiles.
    #[cfg(desktop)]
    use tauri_plugin_global_shortcut::ShortcutState;
    use tauri_plugin_notification;

    let initial_data_dir = db::get_db_path()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(dirs_data_dir_fallback);
    boot_log::init(&initial_data_dir);
    boot_log::log(&format!(
        "Tauri run() invoked (db_path={}, data_dir={})",
        db::get_db_path().display(),
        initial_data_dir.display()
    ));

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
            boot_log::log("Falling back to in-memory database");
            // Keep the webview alive so the user sees an error, not a blank page;
            // desktop never hits this branch (dirs::data_dir always resolves).
            Database::open_memory().expect("open_in_memory must succeed")
        }
    };

    {
        let conn = match database.conn.lock() {
            Ok(g) => g,
            Err(e) => {
                boot_log::log(&format!("sweep: lock failed: {e}"));
                return;
            }
        };
        let now = chrono::Utc::now();
        match business::archive_sweep::sweep_archives(&conn, now) {
            Ok(n) if n > 0 => {
                let msg = format!("[archive] sweep archived {n} items at startup");
                boot_log::log(&msg);
                eprintln!("{msg}");
            }
            Ok(_) => boot_log::log("[archive] sweep: nothing to archive"),
            Err(e) => {
                let msg = format!("[archive] sweep failed: {e}");
                boot_log::log(&msg);
                eprintln!("{msg}");
            }
        }
    }

    // ── Background cloud sync ────────────────────────
    {
        let conn = match database.conn.lock() {
            Ok(g) => g,
            Err(e) => {
                boot_log::log(&format!("sync: lock failed: {e}"));
                return;
            }
        };
        let is_linked = sync::is_linked(&conn).unwrap_or(false);
        if is_linked {
            boot_log::log("[sync] cloud sync linked — spawning periodic sync");
        } else {
            boot_log::log("[sync] not linked — periodic sync will idle-poll is_linked");
        }
        sync::spawn_periodic(db::get_db_path(), 300);
    }

    // Pull any avatars from the legacy <appdata>/Weavine/avatars/ tree into
    // the new com.weavine.desktop/ tree. Idempotent; skipped on first install.
    commands::media::migrate_legacy_avatars();

    tauri::Builder::default()
        .manage(database)
        .register_uri_scheme_protocol("files", |_ctx, request| {
            use tauri::http::{Response, StatusCode};
            let path = request.uri().path().to_string();
            let key = path.trim_start_matches("/files/");
            let Ok(base) = commands::media::data_dir() else {
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap();
            };
            let full = base.join(key);
            // Guard against path traversal: resolved path must stay under base.
            if !full.starts_with(&base) {
                return Response::builder()
                    .status(StatusCode::FORBIDDEN)
                    .body(Vec::new())
                    .unwrap();
            }
            match std::fs::read(&full) {
                Ok(bytes) => {
                    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("");
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", commands::media::mime_from_ext(ext))
                        .body(bytes)
                        .unwrap()
                }
                Err(_) => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(|app| {
            // Canonical app data dir, resolved before any command that needs
            // install_id / device_key / voice model paths runs. On Android
            // `app.path().app_data_dir()` returns `/data/user/0/<app_id>`,
            // which is the only writable location on the platform.
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                install_id::set_app_data_dir(app_data_dir);
            }
            // Local-flavor APK ships the SenseVoice model pre-bundled under
            // `assets/sense-voice/` (see tauri.local.conf.json::bundle.resources).
            // Tauri 2 stores those files in Android's AssetManager, not on the
            // filesystem, so extract them to the app data dir once at startup —
            // `voice_local::model_dir()` / `model_status()` then see a real path.
            //
            // The 228 MB model extraction blocks on JNI reads + filesystem
            // writes — running it on Tauri's setup thread causes ANRs and
            // memory-pressure OOM kills on low-RAM devices (observed on
            // v1.0.25). Move it to spawn_blocking so the webview can show
            // while extraction runs in the background.
            #[cfg(feature = "voice-local")]
            {
                tauri::async_runtime::spawn_blocking(|| {
                    boot_log::log("Starting sense-voice model extraction in background");
                    match android_assets::extract_sense_voice_to_data_dir() {
                        Ok(()) => {
                            boot_log::log("sense-voice model extracted to data dir");
                            eprintln!("[weavine] sense-voice model extracted to data dir");
                        }
                        Err(e) => {
                            let msg = format!("sense-voice model extraction failed: {e}");
                            boot_log::log(&msg);
                            eprintln!("[weavine] {msg}");
                            STARTUP_ERROR.set(msg).ok();
                        }
                    }
                });
            }
            install_id::spawn_first_launch_ping(app.handle().clone());
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["CommandOrControl+K"])?
                        .with_handler(|app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                let _ = app.emit("ctrl-k-pressed", ());
                            }
                        })
                        .build(),
                )?;
            }
            app.handle().plugin(tauri_plugin_notification::init())?;
            let handle = app.handle().clone();
            let db = handle.state::<crate::db::Database>();
            commands::notification::startup_catch_up(&handle, db.inner());
            {
                let conn = match db.inner().conn.lock() {
                    Ok(g) => g,
                    Err(e) => {
                        eprintln!("[startup] keep_in_touch: db lock poisoned: {e}");
                        return Ok(());
                    }
                };
                match business::keep_in_touch::schedule_all(&conn) {
                    Ok(n) if n > 0 => {
                        eprintln!("[startup] keep_in_touch: re-scheduled {n} reminders");
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("[startup] keep_in_touch::schedule_all failed: {e}");
                    }
                }
                match business::auto_log::run_with_default_window(&conn) {
                    Ok(n) if n > 0 => {
                        eprintln!("[startup] auto_log: wrote {n} interactions");
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("[startup] auto_log::run failed: {e}");
                    }
                }
            }
            Ok(())
        })
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
            event::list_event_participants,
            event::add_event_participant,
            event::set_event_participant_role,
            event::remove_event_participant,
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
            cmd_install_id::get_install_id,
            project::list_projects,
            project::create_project,
            project::update_project,
            project::delete_project,
            project::get_project,
            project::list_project_stages,
            project_contact::add_project_contact,
            project_contact::list_project_contacts,
            project_contact::remove_project_contact,
            media::upload_avatar,
            media::get_avatar,
            media::delete_avatar,
            media::list_media_by_owner,
            media::get_media_data_url,
            media::delete_media,
            ocr::extract_card,
        ocr::save_card_image,
            voice::recognize_voice,
            #[cfg(feature = "voice-local")]
            commands::voice_local::check_voice_model,
            #[cfg(feature = "voice-local")]
            commands::voice_local::recognize_voice_local,
            commands::sync::cloud_login,
            commands::sync::cloud_logout,
            commands::sync::cloud_sync_now,
            commands::sync::cloud_status,
            commands::archive::archive_sweep,
            quick::quick_parse,
            commands::notification::fire_notification,
            commands::notification::schedule_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(feature = "tauri"))]
pub fn run() {
    eprintln!("weavine_lib::run() is only available with the 'tauri' feature");
    eprintln!("build the 'weavine-web' bin instead for the web server");
}
