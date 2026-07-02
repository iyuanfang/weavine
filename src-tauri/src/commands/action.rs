use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateActionInput {
    pub owner_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateActionInput {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub completed_at: Option<String>,
}

#[tauri::command]
pub fn list_actions(
    db: State<Database>,
    owner_id: String,
    status: Option<String>,
    contact_id: Option<String>,
    event_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Action>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::action::list(
        &conn,
        &owner_id,
        status.as_deref(),
        contact_id.as_deref(),
        event_id.as_deref(),
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
