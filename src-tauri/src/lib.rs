pub mod commands;
pub mod db;
pub mod models;

use commands::{action, contact, event, interaction, reminder, search, setting, tag};
use tauri::{Emitter, Manager};
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
                let _ = handle.emit("server-status", ServerStatusPayload {
                    status: "starting".into(),
                    message: "正在启动后端服务...".into(),
                });

                match spawn_standalone_server(&handle, &server_state) {
                    Ok(_) => {
                        SERVER_READY.store(true, Ordering::SeqCst);
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
                        if let Ok(data_dir) = handle.path().app_data_dir() {
                            let _ = fs::create_dir_all(&data_dir);
                            let _ = fs::write(data_dir.join("startup-error.log"), &e);
                        }
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

fn resolve_node_path(app: &tauri::AppHandle, server_dir: &PathBuf) -> PathBuf {
    let node_name = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(not(dev)) {
        // 1. Bundled alongside exe (Tauri resource_dir = exe dir on Windows)
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("node_bin").join(node_name));
            // Also try common variations
            candidates.push(resource_dir.join("resources").join("node_bin").join(node_name));
        }
        // 2. Relative to exe path
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(exe_dir.join("node_bin").join(node_name));
                candidates.push(exe_dir.join("resources").join("node_bin").join(node_name));
            }
        }
    }

    // 3. Dev/test fallback
    candidates.push(server_dir.join("../../node_bin").join(node_name));
    candidates.push(server_dir.join("../node_bin").join(node_name));

    for p in &candidates {
        if p.exists() {
            println!("[weavine] Using Node.js at {}", p.display());
            return p.clone();
        }
    }

    println!("[weavine] Using system Node.js from PATH (searched {:?})", candidates);
    PathBuf::from("node")
}

fn find_server_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let candidates: Vec<PathBuf> = {
        let mut v = Vec::new();
        if cfg!(not(dev)) {
            // 1. resource_dir() based
            if let Ok(rd) = app.path().resource_dir() {
                v.push(rd.join("standalone-bundle"));
                v.push(rd.join("resources").join("standalone-bundle"));
            }
            // 2. exe-relative
            if let Ok(exe) = std::env::current_exe() {
                if let Some(d) = exe.parent() {
                    v.push(d.join("standalone-bundle"));
                    v.push(d.join("resources").join("standalone-bundle"));
                }
            }
        }
        // 3. Dev fallback
        v.push(std::env::current_dir().unwrap_or_default().join(".next/standalone"));
        v.push(PathBuf::from(".next/standalone"));
        v
    };

    for d in &candidates {
        let server_js = d.join("server.js");
        if server_js.exists() {
            println!("[weavine] Found server dir at {}", d.display());
            return Ok(d.clone());
        }
    }

    Err(format!(
        "server.js not found. Searched:\n  {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n  ")
    ))
}

fn spawn_standalone_server(
    app: &tauri::AppHandle,
    state: &tauri::State<ServerProcess>,
) -> Result<(), String> {
    let server_dir = find_server_dir(app)?;

    let db_path = ensure_database(app, &server_dir)?;
    let db_url = format!("file:{}", db_path.display());

    let node_path = resolve_node_path(app, &server_dir);
    let mut cmd = Command::new(&node_path);

    // Prevent a console window from appearing on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

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
        .map_err(|e| format!("Failed to spawn node at {}: {e}", node_path.display()))?;

    let child_stderr = child.stderr.take();
    let child_stdout = child.stdout.take();

    if let Some(stderr) = child_stderr {
        thread::spawn(move || {
            let mut buf = String::new();
            let mut reader = BufReader::new(stderr);
            while reader.read_line(&mut buf).unwrap_or(0) > 0 {
                eprintln!("[next:stderr] {}", buf.trim_end());
                buf.clear();
            }
        });
    }
    if let Some(stdout) = child_stdout {
        thread::spawn(move || {
            let mut buf = String::new();
            let mut reader = BufReader::new(stdout);
            while reader.read_line(&mut buf).unwrap_or(0) > 0 {
                println!("[next:stdout] {}", buf.trim_end());
                buf.clear();
            }
        });
    }

    let url = format!("http://{SERVER_HOST}:{SERVER_PORT}/api/health");
    let deadline = Instant::now() + Duration::from_secs(SERVER_STARTUP_TIMEOUT_SECS);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "Next.js server exited prematurely (code: {:?}, signal: {:?})",
                    status.code(),
                    status.signal(),
                ));
            }
            Ok(None) => {}
            Err(e) => {
                return Err(format!("Error checking child process: {e}"));
            }
        }

        if is_server_up(&url) {
            println!("[weavine] Next.js server ready at {url}");
            *state.0.lock().unwrap() = Some(child);
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    let _ = child.kill();
    let _ = child.wait();
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