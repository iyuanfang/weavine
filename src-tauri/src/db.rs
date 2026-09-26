use rusqlite::{Connection, OpenFlags, Result};
use std::path::PathBuf;
use std::sync::Mutex;

/// Pragmas every connection to the on-disk database must set.
///
/// `busy_timeout` is the one that is easy to omit and expensive to omit: WAL
/// admits a single writer at a time and rusqlite's default timeout is zero, so
/// a connection that finds the write lock held fails **immediately** with
/// `SQLITE_BUSY` ("database is locked") instead of waiting its turn.
///
/// That is not a rare interleaving any more. The sync thread runs cycles on its
/// own connection, and since 2026-09-26 the app also kicks a cycle ~2 s after
/// every local write, so a UI write and a sync write now overlap as a matter of
/// course. Without a timeout the loser of that race surfaces to the user as a
/// spurious error on a perfectly valid write.
///
/// Every ad-hoc on-disk connection must use this constant too — see
/// `sync::spawn_periodic`, `sync::spawn_pending_avatar_upload` and
/// `commands::sync::open_db`.
pub(crate) const CONN_PRAGMAS: &str =
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;";

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_db_path();
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE;
        let conn = Connection::open_with_flags(&db_path, flags)?;
        let _ = conn.execute_batch(CONN_PRAGMAS);
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
