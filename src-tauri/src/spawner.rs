use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

pub const SERVER_PORT: u16 = 3199;
pub const SERVER_HOST: &str = "127.0.0.1";
pub const SERVER_STARTUP_TIMEOUT_SECS: u64 = 30;

pub fn resolve_db_path(data_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("create data_dir: {e}"))?;
    Ok(data_dir.join("dev.db"))
}

pub fn ensure_database(data_dir: &Path, server_dir: &Path) -> Result<PathBuf, String> {
    let db_path = resolve_db_path(data_dir)?;
    if db_path.exists() {
        return Ok(db_path);
    }
    let bundled_db = server_dir.join("dev.db");
    if bundled_db.exists() {
        fs::copy(&bundled_db, &db_path)
            .map_err(|e| format!("copy dev.db from bundle: {e}"))?;
        println!("[spawner] Copied pre-initialized dev.db to {:?}", db_path);
    } else {
        println!("[spawner] No bundled dev.db found — Prisma will create it");
    }
    Ok(db_path)
}

pub fn resolve_node_path(resource_dir: &Path, server_dir: &Path) -> PathBuf {
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };

    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(not(dev)) {
        candidates.push(resource_dir.join("node_bin").join(node_name));
        candidates.push(resource_dir.join("resources").join("node_bin").join(node_name));
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(exe_dir.join("node_bin").join(node_name));
                candidates.push(exe_dir.join("resources").join("node_bin").join(node_name));
                if let Some(project) = exe_dir.parent() {
                    candidates.push(project.join("node_bin").join(node_name));
                }
            }
        }
    }

    candidates.push(server_dir.join("../../node_bin").join(node_name));
    candidates.push(server_dir.join("../node_bin").join(node_name));

    for p in &candidates {
        if p.exists() {
            println!("[spawner] Using Node.js at {}", p.display());
            return p.clone();
        }
    }

    println!("[spawner] Falling back to system 'node' on PATH (searched {:?})", candidates);
    PathBuf::from("node")
}

pub fn find_server_dir(resource_dir: &Path) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(not(dev)) {
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
    }

    candidates.push(std::env::current_dir().unwrap_or_default().join(".next/standalone"));
    candidates.push(PathBuf::from(".next/standalone"));

    for d in &candidates {
        if d.join("server.js").exists() {
            println!("[spawner] Found server dir at {}", d.display());
            return Ok(d.clone());
        }
    }

    Err(format!(
        "server.js not found. Searched:\n  {}",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n  ")
    ))
}

pub fn is_server_up(host: &str, port: u16) -> bool {
    use std::net::TcpStream;
    TcpStream::connect_timeout(
        &format!("{host}:{port}").parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

pub fn spawn(
    resource_dir: &Path,
    data_dir: &Path,
    port: u16,
    host: &str,
    timeout_secs: u64,
) -> Result<Child, String> {
    let server_dir = find_server_dir(resource_dir)?;
    let db_path = ensure_database(data_dir, &server_dir)?;
    let db_url = format!("file:{}", db_path.display());

    let node_path = resolve_node_path(resource_dir, &server_dir);
    let mut cmd = Command::new(&node_path);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.current_dir(&server_dir)
        .arg("server.js")
        .env("PORT", port.to_string())
        .env("HOSTNAME", host)
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

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) => {
                #[cfg(unix)]
                let sig = status.signal();
                #[cfg(not(unix))]
                let sig: Option<i32> = None;
                return Err(format!(
                    "Next.js server exited prematurely (code: {:?}, signal: {:?})",
                    status.code(),
                    sig,
                ));
            }
            Ok(None) => {}
            Err(e) => return Err(format!("Error checking child process: {e}")),
        }

        if is_server_up(host, port) {
            println!("[spawner] Next.js server ready at {host}:{port}");
            return Ok(child);
        }
        thread::sleep(Duration::from_millis(200));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err(format!("Next.js server failed to start within {timeout_secs}s"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn make_temp_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "spawner-test-{}-{}-{}",
            label,
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_minimal_server_js(dir: &Path) {
        let js = r#"
const http = require('http');
const port = parseInt(process.env.PORT || '3199', 10);
const hostname = process.env.HOSTNAME || '127.0.0.1';
const srv = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404); res.end();
});
srv.listen(port, hostname, () => console.log(`listening ${hostname}:${port}`));
"#;
        fs::write(dir.join("server.js"), js).unwrap();
    }

    fn ureq_get(url: &str) -> String {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        let url = url.trim_start_matches("http://");
        let (host_port, path) = url.split_once('/').unwrap_or((url, ""));
        let (host, port) = host_port.split_once(':').unwrap();
        let port: u16 = port.parse().unwrap();
        let mut s = TcpStream::connect((host, port)).unwrap();
        let req = format!(
            "GET /{} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n",
            path
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        buf
    }

    #[test]
    fn find_server_dir_tauri_v2_layout() {
        let tmp = make_temp_dir("v2");
        let bundle = tmp.join("standalone-bundle");
        fs::create_dir_all(&bundle).unwrap();
        write_minimal_server_js(&bundle);

        let found = find_server_dir(&tmp).unwrap();
        assert_eq!(
            fs::canonicalize(&found).unwrap(),
            fs::canonicalize(&bundle).unwrap()
        );
    }

    #[test]
    fn find_server_dir_tauri_v1_layout() {
        let tmp = make_temp_dir("v1");
        let bundle = tmp.join("resources").join("standalone-bundle");
        fs::create_dir_all(&bundle).unwrap();
        write_minimal_server_js(&bundle);

        let found = find_server_dir(&tmp).unwrap();
        assert_eq!(
            fs::canonicalize(&found).unwrap(),
            fs::canonicalize(&bundle).unwrap()
        );
    }

    #[test]
    fn find_server_dir_missing_returns_error() {
        let tmp = make_temp_dir("missing");
        let prev = std::env::current_dir().unwrap();
        std::env::set_current_dir(&tmp).unwrap();
        let result = find_server_dir(&tmp);
        std::env::set_current_dir(&prev).unwrap();
        let err = result.unwrap_err();
        assert!(err.contains("server.js not found"));
        assert!(err.contains(&tmp.display().to_string()));
    }

    #[test]
    fn resolve_node_path_finds_existing_binary() {
        let tmp = make_temp_dir("node");
        let node_dir = tmp.join("node_bin");
        fs::create_dir_all(&node_dir).unwrap();
        let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
        let node_path = node_dir.join(node_name);
        fs::write(&node_path, b"#!/bin/sh\necho hi\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = fs::metadata(&node_path).unwrap().permissions();
            perm.set_mode(0o755);
            fs::set_permissions(&node_path, perm).unwrap();
        }

        let found = resolve_node_path(&tmp, &tmp);
        assert_eq!(
            fs::canonicalize(&found).unwrap(),
            fs::canonicalize(&node_path).unwrap()
        );
    }

    #[test]
    fn resolve_node_path_fallback_when_missing() {
        let tmp = make_temp_dir("nofallback");
        let found = resolve_node_path(&tmp, &tmp);
        assert_eq!(found, PathBuf::from("node"));
    }

    #[test]
    fn ensure_database_copies_from_bundle() {
        let tmp = make_temp_dir("db");
        let bundle = tmp.join("bundle");
        fs::create_dir_all(&bundle).unwrap();
        let bundled_db = bundle.join("dev.db");
        fs::write(&bundled_db, b"SQLite-placeholder").unwrap();

        let data = tmp.join("data");
        let db_path = ensure_database(&data, &bundle).unwrap();
        assert!(db_path.exists());
        let copied = fs::read(&db_path).unwrap();
        assert_eq!(copied, b"SQLite-placeholder");
    }

    #[test]
    fn ensure_database_reuses_existing() {
        let tmp = make_temp_dir("dbreuse");
        let bundle = tmp.join("bundle");
        fs::create_dir_all(&bundle).unwrap();
        let data = tmp.join("data");
        fs::create_dir_all(&data).unwrap();
        let existing = data.join("dev.db");
        fs::write(&existing, b"existing-db").unwrap();

        let db_path = ensure_database(&data, &bundle).unwrap();
        let content = fs::read(&db_path).unwrap();
        assert_eq!(content, b"existing-db");
    }

    #[test]
    fn spawn_full_lifecycle() {
        let tmp = make_temp_dir("spawn");
        let bundle = tmp.join("standalone-bundle");
        fs::create_dir_all(&bundle).unwrap();
        write_minimal_server_js(&bundle);
        let data = tmp.join("data");

        let port: u16 = 4000 + ((COUNTER.load(Ordering::SeqCst) as u16) % 1000);
        let mut child = spawn(&tmp, &data, port, "127.0.0.1", 10).expect("spawn should succeed");

        let url = format!("http://127.0.0.1:{port}/api/health");
        let body = ureq_get(&url);
        assert!(body.contains("status"), "unexpected body: {body}");
        assert!(body.contains("ok") || body.contains("OK"), "unexpected body: {body}");

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn spawn_reports_missing_server_js_with_all_paths() {
        let tmp = make_temp_dir("nope");
        let prev = std::env::current_dir().unwrap();
        std::env::set_current_dir(&tmp).unwrap();
        let res = spawn(&tmp, &tmp.join("data"), 4999, "127.0.0.1", 2);
        std::env::set_current_dir(&prev).unwrap();
        let err = res.unwrap_err();
        assert!(err.contains("server.js not found"), "got: {err}");
        assert!(err.contains("Searched:"), "got: {err}");
    }

    #[test]
    fn spawn_uses_node_from_resource_dir_node_bin() {
        let tmp = make_temp_dir("nodebin");
        let bundle = tmp.join("standalone-bundle");
        fs::create_dir_all(&bundle).unwrap();
        write_minimal_server_js(&bundle);
        let node_dir = tmp.join("node_bin");
        fs::create_dir_all(&node_dir).unwrap();
        let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
        let node_path = node_dir.join(node_name);
        fs::write(&node_path, b"#!/bin/sh\nexec node \"$@\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = fs::metadata(&node_path).unwrap().permissions();
            p.set_mode(0o755);
            fs::set_permissions(&node_path, p).unwrap();
        }

        let port: u16 = 4500 + ((COUNTER.load(Ordering::SeqCst) as u16) % 200);
        let mut child = spawn(&tmp, &tmp.join("data"), port, "127.0.0.1", 8)
            .expect("spawn should use bundled node");

        let url = format!("http://127.0.0.1:{port}/api/health");
        let body = ureq_get(&url);
        assert!(body.contains("status"), "bundled node did not respond: {body}");

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn spawn_reports_premature_exit_with_code() {
        let tmp = make_temp_dir("crash");
        let bundle = tmp.join("standalone-bundle");
        fs::create_dir_all(&bundle).unwrap();
        let crash_js = "process.exit(7);\n";
        fs::write(bundle.join("server.js"), crash_js).unwrap();

        let port: u16 = 4700 + ((COUNTER.load(Ordering::SeqCst) as u16) % 100);
        let res = spawn(&tmp, &tmp.join("data"), port, "127.0.0.1", 3);
        let err = res.unwrap_err();
        assert!(
            err.contains("exited prematurely") && err.contains("Some(7)"),
            "expected premature exit code 7, got: {err}"
        );
    }

    #[test]
    fn spawn_concurrent_independent_ports() {
        let tmp1 = make_temp_dir("conc1");
        let tmp2 = make_temp_dir("conc2");
        for tmp in [&tmp1, &tmp2] {
            let bundle = tmp.join("standalone-bundle");
            fs::create_dir_all(&bundle).unwrap();
            write_minimal_server_js(&bundle);
        }

        let base: u16 = 4800 + ((COUNTER.load(Ordering::SeqCst) as u16) % 50);
        let mut c1 = spawn(&tmp1, &tmp1.join("data"), base, "127.0.0.1", 8).unwrap();
        let mut c2 = spawn(&tmp2, &tmp2.join("data"), base + 1, "127.0.0.1", 8).unwrap();

        let b1 = ureq_get(&format!("http://127.0.0.1:{base}/api/health"));
        let b2 = ureq_get(&format!("http://127.0.0.1:{}/api/health", base + 1));
        assert!(b1.contains("status"), "child1 body: {b1}");
        assert!(b2.contains("status"), "child2 body: {b2}");

        let _ = c1.kill(); let _ = c1.wait();
        let _ = c2.kill(); let _ = c2.wait();
    }
}