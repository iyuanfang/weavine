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
    include_archived: Option<bool>,
) -> Result<SearchResults, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let include_archived = include_archived.unwrap_or(true);
    business::search::search(&conn, &owner_id, &query, limit, include_archived)
        .map_err(|e| e.to_string())
}
