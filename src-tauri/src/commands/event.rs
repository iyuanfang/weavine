use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEventInput {
    pub owner_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub contact_id: Option<String>,
    pub reminder_lead_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEventInput {
    #[serde(default)]
    pub id: String,
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub contact_id: Option<String>,
    pub reminder_lead_minutes: Option<i64>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_events(
    db: State<Database>,
    owner_id: String,
    contact_id: Option<String>,
    start_after: Option<String>,
    start_before: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Event>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::list(
        &conn,
        &owner_id,
        contact_id.as_deref(),
        start_after.as_deref(),
        start_before.as_deref(),
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
    owner_id: String,
    limit: Option<i64>,
) -> Result<Vec<Event>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::event::get_upcoming(&conn, &owner_id, limit).map_err(|e| e.to_string())
}
