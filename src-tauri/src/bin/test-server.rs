//! Standalone test binary: exercises the server-spawning logic without the GUI.
//!
//! Usage:
//!   cargo run --bin test-server -- <resource_dir> <data_dir>
//!
//! Both args are optional. If omitted, defaults are used:
//!   resource_dir: parent of the project (where standalone-bundle/ and node_bin/ live)
//!   data_dir:     ./test-data
//!
//! This binary re-implements the resource-resolution + child-process logic from
//! `lib.rs::spawn_standalone_server` so we can validate it on the local dev
//! machine before pushing to CI. The logic mirrors lib.rs as closely as
//! possible so the test is meaningful.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

const SERVER_PORT: u16 = 3199;
const SERVER_HOST: &str = "127.0.0.1";
const SERVER_STARTUP_TIMEOUT_SECS: u64 = 15;

fn resolve_db_path(data_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("create data_dir: {e}"))?;
    Ok(data_dir.join("dev.db"))
}

fn ensure_database(data_dir: &Path, server_dir: &Path) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(data_dir)?;
    if db_path.exists() {
        return Ok(db_path);
    }
    let bundled_db = server_dir.join("dev.db");
    if bundled_db.exists() {
        fs::copy(&bundled_db, &db_path).map_err(|e| format!("copy dev.db: {e}"))?;
        println!("[test] Copied dev.db to {}", db_path.display());
    } else {
        println!("[test] No bundled dev.db found — Prisma will create it");
    }
    Ok(db_path)
}

fn resolve_node_path(resource_dir: &Path, server_dir: &Path) -> PathBuf {
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };

    let mut candidates: Vec<PathBuf> = Vec::new();
    candidates.push(resource_dir.join("node_bin").join(node_name));
    candidates.push(resource_dir.join("resources").join("node_bin").join(node_name));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("node_bin").join(node_name));
            candidates.push(exe_dir.join("resources").join("node_bin").join(node_name));
            // Also walk up — exe might be in target/debug/ inside the project
            if let Some(project) = exe_dir.parent() {
                candidates.push(project.join("node_bin").join(node_name));
            }
        }
    }
    candidates.push(server_dir.join("../../node_bin").join(node_name));
    candidates.push(server_dir.join("../node_bin").join(node_name));

    for p in &candidates {
        if p.exists() {
            println!("[test] Using Node.js at {}", p.display());
            return p.clone();
        }
    }
    println!("[test] Falling back to system 'node' on PATH");
    PathBuf::from("node")
}

fn find_server_dir(resource_dir: &Path) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    candidates.push(resource_dir.join("standalone-bundle"));
    candidates.push(resource_dir.join("resources").join("standalone-bundle"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            candidates.push(d.join("standalone-bundle"));
            candidates.push(d.join("resources").join("standalone-bundle"));
            if let Some(project) = d.parent() {
                candidates.push(project.join("standalone-bundle"));
            }
        }
    }
    candidates.push(std::env::current_dir().unwrap_or_default().join(".next/standalone"));
    candidates.push(PathBuf::from(".next/standalone"));

    for d in &candidates {
        if d.join("server.js").exists() {
            println!("[test] Found server dir at {}", d.display());
            return Ok(d.clone());
        }
    }
    Err(format!(
        "server.js not found. Searched:\n  {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n  ")
    ))
}

fn is_server_up(url: &str) -> bool {
    use std::net::TcpStream;
    let parts: Vec<&str> = url.split(':').collect();
    if parts.len() < 3 { return false; }
    let host = parts[1].trim_start_matches("//");
    let port: u16 = match parts[2].split('/').next().unwrap_or("").parse() {
        Ok(p) => p,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(
        &format!("{host}:{port}").parse().unwrap(),
        Duration::from_millis(500),
    ).is_ok()
}

fn spawn_standalone_server(resource_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let server_dir = find_server_dir(resource_dir)?;
    let db_path = ensure_database(data_dir, &server_dir)?;
    let db_url = format!("file:{}", db_path.display());
    let node_path = resolve_node_path(resource_dir, &server_dir);

    println!("[test] server_dir = {}", server_dir.display());
    println!("[test] db_path = {}", db_path.display());
    println!("[test] node = {}", node_path.display());

    let mut cmd = Command::new(&node_path);
    cmd.current_dir(&server_dir)
        .arg("server.js")
        .env("PORT", SERVER_PORT.to_string())
        .env("HOSTNAME", SERVER_HOST)
        .env("DATABASE_URL", &db_url)
        .env("IS_DESKTOP", "true")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn {}: {e}", node_path.display()))?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut buf = String::new();
            let mut reader = BufReader::new(stderr);
            while reader.read_line(&mut buf).unwrap_or(0) > 0 {
                eprintln!("[next:stderr] {}", buf.trim_end());
                buf.clear();
            }
        });
    }
    if let Some(stdout) = child.stdout.take() {
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
                #[cfg(unix)]
                let sig = status.signal();
                #[cfg(not(unix))]
                let sig: Option<i32> = None;
                return Err(format!(
                    "Node exited prematurely (code: {:?}, signal: {:?})",
                    status.code(),
                    sig,
                ));
            }
            Ok(None) => {}
            Err(e) => return Err(format!("try_wait error: {e}")),
        }
        if is_server_up(&url) {
            println!("[test] ✓ Server is UP at {url}");
            // Don't kill it — let the user curl it
            // For test purposes, sleep briefly then exit
            thread::sleep(Duration::from_millis(500));
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(format!("Server failed to come up within {SERVER_STARTUP_TIMEOUT_SECS}s"))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let project_root = env::current_dir().unwrap();
    let resource_dir = args.get(1).cloned().unwrap_or_else(|| project_root.display().to_string());
    let data_dir = args.get(2).cloned().unwrap_or_else(|| format!("{}/test-data", project_root.display()));

    let resource_dir = PathBuf::from(resource_dir);
    let data_dir = PathBuf::from(data_dir);

    println!("[test] resource_dir = {}", resource_dir.display());
    println!("[test] data_dir = {}", data_dir.display());

    match spawn_standalone_server(&resource_dir, &data_dir) {
        Ok(()) => {
            println!("[test] ✓ SUCCESS");
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("[test] ✗ FAILED: {e}");
            std::process::exit(1);
        }
    }
}
