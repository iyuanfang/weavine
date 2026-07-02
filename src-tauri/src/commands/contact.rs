use crate::business;
use crate::db::Database;
use crate::models::*;
use tauri::State;

#[tauri::command]
pub fn list_contacts(
    db: State<Database>,
    p: ListContactsParams,
) -> Result<Vec<Contact>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::contact::list(&conn, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_contact(
    db: State<Database>,
    input: CreateContactInput,
) -> Result<Contact, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::contact::create(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_contact(
    db: State<Database>,
    input: UpdateContactInput,
) -> Result<Contact, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::contact::update(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_contact(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::contact::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_contact(db: State<Database>, id: String) -> Result<Contact, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    business::contact::get(&conn, &id).map_err(|e| e.to_string())
}
