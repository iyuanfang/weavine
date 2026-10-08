use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command]
pub fn list_notes(
    db: State<Database>,
    input: ListNotesInput,
) -> Result<(Vec<Note>, bool), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list(&conn, &input.user_id, input.cursor.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note(db: State<Database>, input: GetNoteInput) -> Result<Option<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::get(&conn, &input.user_id, &input.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(
    db: State<Database>,
    input: CreateNoteInput,
) -> Result<Note, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::create(&conn, &input.user_id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(
    db: State<Database>,
    input: UpdateNoteInput,
) -> Result<Option<Note>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::update(&conn, &input.user_id, &input.id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(db: State<Database>, input: DeleteNoteInput) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::delete(&conn, &input.user_id, &input.id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_note_backlinks(
    db: State<Database>,
    input: ListNoteBacklinksInput,
) -> Result<Vec<NoteBacklink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list_backlinks(&conn, &input.user_id, &input.entity_type, &input.entity_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_note_entities(
    db: State<Database>,
    input: ListNoteEntitiesInput,
) -> Result<Vec<NoteEntityLink>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::note::list_note_entities(&conn, &input.user_id, &input.note_id)
        .map_err(|e| e.to_string())
}