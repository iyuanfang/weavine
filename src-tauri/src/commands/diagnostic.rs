use crate::business;
use crate::business::diagnostic::StartupInfo;
use crate::db::Database;
use crate::models::LocalUser;
use tauri::State;

#[tauri::command]
pub fn get_startup_info() -> StartupInfo {
    business::diagnostic::get_startup_info()
}

#[tauri::command]
pub fn get_local_user(db: State<Database>) -> Result<LocalUser, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::diagnostic::get_local_user(&conn).map_err(|e| format!("no local user: {e}"))
}
