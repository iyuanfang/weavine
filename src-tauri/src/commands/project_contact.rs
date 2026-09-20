use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddProjectContactInput {
    pub project_id: String,
    pub contact_id: String,
    pub role: Option<String>,
}

#[tauri::command]
pub fn add_project_contact(
    db: State<Database>,
    input: AddProjectContactInput,
) -> Result<ProjectContact, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project_contact::add(
        &conn,
        &input.project_id,
        &input.contact_id,
        input.role.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn list_project_contacts(
    db: State<Database>,
    project_id: String,
) -> Result<Vec<ProjectContactWithContact>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project_contact::list_contacts_for_project(&conn, &project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_project_contact(
    db: State<Database>,
    project_id: String,
    contact_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::project_contact::remove(&conn, &project_id, &contact_id)
        .map_err(|e| e.to_string())
}