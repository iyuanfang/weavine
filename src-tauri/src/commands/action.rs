use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::Deserialize;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn list_actions(
    db: State<Database>,
    owner_id: String,
    status: Option<String>,
    contact_id: Option<String>,
    project_id: Option<String>,
    archived: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Action>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::list(
        &conn,
        &owner_id,
        status.as_deref(),
        contact_id.as_deref(),
        project_id.as_deref(),
        archived.as_deref(),
        limit,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_action(
    db: State<Database>,
    input: CreateActionInput,
) -> Result<Action, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_action(
    db: State<Database>,
    input: UpdateActionInput,
) -> Result<Action, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_action(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_action(db: State<Database>, id: String) -> Result<Action, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::get(&conn, &id).map_err(|e| e.to_string())
}
