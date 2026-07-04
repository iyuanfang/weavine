use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::Deserialize;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn list_interactions(
    db: State<Database>,
    user_id: String,
    contact_id: Option<String>,
    action_id: Option<String>,
    event_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Interaction>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::interaction::list(
        &conn,
        &user_id,
        contact_id.as_deref(),
        action_id.as_deref(),
        event_id.as_deref(),
        limit,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_interaction(
    db: State<Database>,
    input: CreateInteractionInput,
) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::interaction::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_interaction(
    db: State<Database>,
    input: UpdateInteractionInput,
) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::interaction::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_interaction(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::interaction::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_interaction(db: State<Database>, id: String) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::interaction::get(&conn, &id).map_err(|e| e.to_string())
}
