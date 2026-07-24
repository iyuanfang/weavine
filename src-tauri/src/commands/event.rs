use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn list_events(
    db: State<Database>,
    user_id: String,
    contact_id: Option<String>,
    project_id: Option<String>,
    start_after: Option<String>,
    start_before: Option<String>,
    archived: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Event>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::list(
        &conn,
        &user_id,
        contact_id.as_deref(),
        project_id.as_deref(),
        start_after.as_deref(),
        start_before.as_deref(),
        archived.as_deref(),
        limit,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_event(
    db: State<Database>,
    input: CreateEventInput,
) -> Result<Event, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_event(
    db: State<Database>,
    input: UpdateEventInput,
) -> Result<Event, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_event(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_event(db: State<Database>, id: String) -> Result<Event, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::get(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_upcoming_events(
    db: State<Database>,
    user_id: String,
    limit: Option<i64>,
) -> Result<Vec<Event>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::get_upcoming(&conn, &user_id, limit).map_err(|e| e.to_string())
}
