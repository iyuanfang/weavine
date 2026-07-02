use crate::db::Database;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct StartupInfo {
    pub server_ready: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_startup_info() -> StartupInfo {
    let error = crate::STARTUP_ERROR.get().map(|s| s.clone());
    StartupInfo {
        server_ready: crate::SERVER_READY.load(std::sync::atomic::Ordering::SeqCst),
        error,
    }
}

#[tauri::command]
pub fn get_local_user(db: State<Database>) -> Result<crate::models::LocalUser, String> {
    use crate::models::LocalUser;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let user = conn
        .query_row(
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
        .map_err(|e| format!("no local user: {e}"))?;
    Ok(user)
}
