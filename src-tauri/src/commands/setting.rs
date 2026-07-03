use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn list_settings(
    db: State<Database>,
    owner_id: String,
) -> Result<Vec<Setting>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::setting::list(&conn, &owner_id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn upsert_setting(
    db: State<Database>,
    owner_id: String,
    key: String,
    value: String,
) -> Result<Setting, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::setting::upsert(&conn, &owner_id, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_setting(
    db: State<Database>,
    owner_id: String,
    key: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::setting::delete(&conn, &owner_id, &key).map_err(|e| e.to_string())
}
