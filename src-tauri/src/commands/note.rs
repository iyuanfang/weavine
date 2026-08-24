use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command]
pub fn list_notes(
    db: State<Database>,
    user_id: String,
    include_archived: Option<bool>,
) -> Result<Vec<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list(&conn, &user_id, include_archived.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note(
    db: State<Database>,
    user_id: String,
    id: String,
) -> Result<Option<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::get(&conn, &user_id, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    db: State<Database>,
    user_id: String,
    input: CreateNoteInput,
) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::create(&conn, &user_id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(
    db: State<Database>,
    user_id: String,
    id: String,
    input: UpdateNoteInput,
) -> Result<Option<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::update(&conn, &user_id, &id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(db: State<Database>, user_id: String, id: String) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::delete(&conn, &user_id, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_note_backlinks(
    db: State<Database>,
    user_id: String,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<NoteBacklink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list_backlinks(&conn, &user_id, &entity_type, &entity_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_note_entities(
    db: State<Database>,
    user_id: String,
    note_id: String,
) -> Result<Vec<NoteEntityLink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list_note_entities(&conn, &user_id, &note_id).map_err(|e| e.to_string())
}