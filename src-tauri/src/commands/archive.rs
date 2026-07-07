use crate::business;
use crate::db::Database;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn archive_sweep(db: State<Database>, user_id: String) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now();
    business::archive_sweep::sweep_archives(&conn, now).map_err(|e| e.to_string())
}