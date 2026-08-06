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

#[tauri::command]
pub fn list_event_participants(
    db: State<Database>,
    event_id: String,
    user_id: String,
) -> Result<Vec<EntityLink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event_participant::list(&conn, &event_id, &user_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_event_participant(
    db: State<Database>,
    event_id: String,
    contact_id: String,
    role: String,
) -> Result<EntityLink, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event_participant::add(&conn, &event_id, &contact_id, &role).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_event_participant_role(
    db: State<Database>,
    event_id: String,
    contact_id: String,
    role: String,
    user_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event_participant::set_role(&conn, &event_id, &contact_id, &role, &user_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_event_participant(
    db: State<Database>,
    event_id: String,
    contact_id: String,
    user_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event_participant::remove(&conn, &event_id, &contact_id, &user_id)
        .map_err(|e| e.to_string())
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
