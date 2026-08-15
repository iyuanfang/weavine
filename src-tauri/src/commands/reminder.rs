use crate::business;
use crate::commands::notification;
use crate::db::Database;
use crate::models::*;
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "snake_case")]
pub fn list_reminders(
    db: State<Database>,
    user_id: String,
    contact_id: Option<String>,
    event_id: Option<String>,
    include_dismissed: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<Reminder>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::reminder::list(
        &conn,
        &user_id,
        contact_id.as_deref(),
        event_id.as_deref(),
        include_dismissed,
        limit,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_reminder(
    app: AppHandle,
    db: State<Database>,
    input: CreateReminderInput,
) -> Result<Reminder, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let r = business::reminder::create(&conn, &input).map_err(|e| e.to_string())?;
    drop(conn);
    notification::schedule_for_reminder(&app, &r);
    Ok(r)
}

#[tauri::command]
pub fn update_reminder(
    app: AppHandle,
    db: State<Database>,
    input: UpdateReminderInput,
) -> Result<Reminder, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let r = business::reminder::update(&conn, &input).map_err(|e| e.to_string())?;
    drop(conn);
    if !r.dispatched && !r.dismissed {
        notification::schedule_for_reminder(&app, &r);
    }
    Ok(r)
}

#[tauri::command]
pub fn delete_reminder(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::reminder::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_reminder(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::reminder::dismiss(&conn, &id).map_err(|e| e.to_string())
}
