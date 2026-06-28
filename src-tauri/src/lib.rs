pub mod commands;
pub mod db;
pub mod models;

use commands::{action, contact, event, interaction, reminder, search, setting, tag};
use db::Database;
use std::io::{BufRead, BufReader};
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            let handle = app.handle();
            let server_state = handle.state::<ServerProcess>();

            if std::env::var("TAURI_DEV").is_err() {
                if let Err(e) = spawn_standalone_server(&server_state) {
                    eprintln!("[weavine] Failed to spawn Next.js server: {e}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<ServerProcess>();
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_standalone_server(state: &tauri::State<ServerProcess>) -> Result<(), String> {
    let resource_dir = tauri::utils::platform::resource_dir();
    let server_dir = if cfg!(dev) {
        std::env::current_dir().unwrap().join(".next/standalone")
    } else {
        resource_dir.join("dist")
    };

    let server_js = server_dir.join("server.js");
    if !server_js.exists() {
        return Err(format!(
            "server.js not found at {} — did the postbuild script run?",
            server_js.display()
        ));
    }

    let mut cmd = Command::new("node");
    cmd.current_dir(&server_dir)
        .arg("server.js")
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", SERVER_HOST)
        .env("DATABASE_URL", "file:./dev.db")
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

    // Wait for server to be ready
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
    // Use std::net for health check (no extra deps)
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
