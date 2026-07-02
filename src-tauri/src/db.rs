use rusqlite::{Connection, OpenFlags, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_path = get_db_path();
        // Open WITHOUT SQLITE_OPEN_CREATE so we never materialize an empty
        // file that would later be confused for a "user database" by the
        // spawner's data-preservation check. The bundled dev.db copy is
        // owned by spawner::ensure_database, which runs later in setup().
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE;
        let conn = match Connection::open_with_flags(&db_path, flags) {
            Ok(c) => c,
            Err(_) => {
                // DB does not exist yet (first install). Return a
                // placeholder connection to an in-memory DB; nothing
                // actually queries it from Rust right now.
                Connection::open_in_memory()?
            }
        };
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
        // Run embedded schema migration (idempotent — safe on every startup).
        crate::migration::run(&conn)?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }
}

fn get_db_path() -> PathBuf {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.weavine.prm");
    std::fs::create_dir_all(&data_dir).ok();
    data_dir.join("dev.db")
}
