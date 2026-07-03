use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn search(
    db: State<Database>,
    owner_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<SearchResults, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::search::search(&conn, &owner_id, &query, limit).map_err(|e| e.to_string())
}
