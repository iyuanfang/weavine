use rusqlite::{Connection, OpenFlags, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_db_path();
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE;
        let conn = Connection::open_with_flags(&db_path, flags)?;
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
        crate::migration::run(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn with_conn<F, T>(&self, f: F) -> Result<T, rusqlite::Error>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let conn = self.conn.lock().expect("db lock poisoned");
        f(&conn)
    }

    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }
}

pub(crate) fn get_db_path() -> PathBuf {
    #[cfg(target_os = "android")]
    {
        // Hardcode `/data/user/0/<app_id>/files` rather than `$HOME/<app_id>/files`.
        // Tauri 2's `app_local_data_dir()` resolves to exactly this path on
        // Android (see `install_id::data_dir`'s fallback arm), and `$HOME`
        // is unreliable across Android API levels — on some devices it points
        // to the read-only root `/`, which makes `Connection::open` fail with
        // EACCES, the database fall back to in-memory, the seed user never
        // get created, and the JS home page loop on "正在加载用户…".
        let path = PathBuf::from("/data/user/0")
            .join(crate::android_data_dir_name())
            .join("files")
            .join("dev.db");
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        return path;
    }

    #[cfg(not(target_os = "android"))]
    {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(crate::android_data_dir_name());
        std::fs::create_dir_all(&data_dir).ok();
        data_dir.join("dev.db")
    }
}
