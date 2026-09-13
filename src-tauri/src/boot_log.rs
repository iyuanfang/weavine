use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn init(data_dir: &Path) {
    let _ = fs::create_dir_all(data_dir);
    let log_path = data_dir.join("boot.log");

    if let Ok(mut guard) = LOG_PATH.lock() {
        *guard = Some(log_path.clone());
    }

    let _ = append_to_log(&format!(
        "\n=== boot at {} ===\n  pid={}\n  exe={}\n  cwd={}\n  data_dir={}\n",
        chrono_like_now(),
        std::process::id(),
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".into()),
        std::env::current_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unknown>".into()),
        data_dir.display(),
    ));

    std::panic::set_hook(Box::new(|info| {
        let payload = format!(
            "PANIC at {}\n{}\n",
            chrono_like_now(),
            info,
        );
        let _ = append_to_log(&payload);
    }));
}

pub fn log(message: &str) {
    let line = format!("[{}] {}\n", chrono_like_now(), message);
    let _ = append_to_log(&line);
}

fn append_to_log(content: &str) -> std::io::Result<()> {
    let guard = LOG_PATH.lock().ok();
    let Some(path) = guard.and_then(|g| g.clone()) else {
        return Ok(());
    };
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    f.write_all(content.as_bytes())?;
    Ok(())
}

fn chrono_like_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{dur}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_writes_header() {
        let tmp = std::env::temp_dir().join(format!(
            "bootlog-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();

        init(&tmp);
        log("hello world");
        log("second line");

        let path = tmp.join("boot.log");
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("boot at"));
        assert!(content.contains("hello world"));
        assert!(content.contains("second line"));
    }
}