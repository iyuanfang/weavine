use crate::business;
use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagInput {
    pub owner_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagInput {
    #[serde(default)]
    pub id: String,
    pub name: Option<String>,
}

#[tauri::command]
pub fn list_tags(db: State<Database>, owner_id: String) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::tag::list(&conn, &owner_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(
    db: State<Database>,
    input: CreateTagInput,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::tag::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tag(
    db: State<Database>,
    input: UpdateTagInput,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::tag::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::tag::delete(&conn, &id).map_err(|e| e.to_string())
}
