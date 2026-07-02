use crate::models::LocalUser;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
pub struct StartupInfo {
    pub server_ready: bool,
    pub error: Option<String>,
}

pub fn get_startup_info() -> StartupInfo {
    let error = crate::STARTUP_ERROR.get().map(|s| s.clone());
    StartupInfo {
        server_ready: error.is_none(),
        error,
    }
}

pub fn get_local_user(conn: &Connection) -> rusqlite::Result<LocalUser> {
    conn.query_row(
        "SELECT id, name, email FROM \"User\" WHERE isLocal = 1 LIMIT 1",
        [],
        |row| {
            Ok(LocalUser {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
            })
        },
    )
}
