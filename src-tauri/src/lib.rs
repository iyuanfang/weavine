pub mod commands;
pub mod db;
pub mod models;

use commands::{action, contact, event, interaction, reminder, search, setting, tag};
use tauri::Manager;
use db::Database;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const SERVER_PORT: u16 = 3199;
const SERVER_HOST: &str = "127.0.0.1";
const SERVER_STARTUP_TIMEOUT_SECS: u64 = 30;

struct ServerProcess(Mutex<Option<Child>>);

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
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let server_state = handle.state::<ServerProcess>();

            if std::env::var("TAURI_DEV").is_err() {
                if let Err(e) = spawn_standalone_server(&handle, &server_state) {
                    eprintln!("[weavine] Failed to spawn Next.js server: {e}");
                    if let Ok(data_dir) = handle.path().app_data_dir() {
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

fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("create app_data_dir: {e}"))?;
    Ok(data_dir.join("dev.db"))
}

fn ensure_database(app: &tauri::AppHandle, server_dir: &PathBuf) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(app)?;

    if db_path.exists() {
        return Ok(db_path);
    }

    let bundled_db = server_dir.join("dev.db");
    if bundled_db.exists() {
        fs::copy(&bundled_db, &db_path)
            .map_err(|e| format!("copy dev.db from bundle: {e}"))?;
        println!("[weavine] Copied pre-initialized dev.db to {:?}", db_path);
    } else {
        println!("[weavine] No bundled dev.db found — Prisma will create it");
    }

    Ok(db_path)
}

fn spawn_standalone_server(
    app: &tauri::AppHandle,
    state: &tauri::State<ServerProcess>,
) -> Result<(), String> {
    let server_dir = if cfg!(dev) {
        std::env::current_dir().unwrap().join(".next/standalone")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| format!("resource_dir: {e}"))?
            .join("standalone-bundle")
    };

    let server_js = server_dir.join("server.js");
    if !server_js.exists() {
        return Err(format!(
            "server.js not found at {} — did the postbuild script run?",
            server_js.display()
        ));
    }

    let db_path = ensure_database(app, &server_dir)?;
    let db_url = format!("file:{}", db_path.display());

    let mut cmd = Command::new("node");
    cmd.current_dir(&server_dir)
        .arg("server.js")
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", SERVER_HOST)
        .env("DATABASE_URL", &db_url)
        .env("IS_DESKTOP", "true")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn node: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                println!("[next] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[next] {line}");
            }
        });
    }

    *state.0.lock().unwrap() = Some(child);

    let url = format!("http://{SERVER_HOST}:{SERVER_PORT}/api/health");
    let deadline = Instant::now() + Duration::from_secs(SERVER_STARTUP_TIMEOUT_SECS);
    while Instant::now() < deadline {
        if is_server_up(&url) {
            println!("[weavine] Next.js server ready at {url}");
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("Next.js server failed to start within timeout".to_string())
}

fn is_server_up(url: &str) -> bool {
    let parts: Vec<&str> = url.split(':').collect();
    if parts.len() < 3 {
        return false;
    }
    let host = parts[1].trim_start_matches("//");
    let port: u16 = match parts[2].split('/').next().unwrap_or("").parse() {
        Ok(p) => p,
        Err(_) => return false,
    };
    use std::net::TcpStream;
    TcpStream::connect_timeout(
        &format!("{host}:{port}").parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}