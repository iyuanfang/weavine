use crate::business;
use crate::db::Database;
use crate::models::ListContactsParams;
use crate::quick::{self, QuickItem};
use chrono::Utc;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn quick_parse(
    db: State<Database>,
    user_id: String,
    text: String,
    contact_names: Vec<String>,
) -> Result<QuickItem, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut contacts = Vec::new();
    if !contact_names.is_empty() {
        let p = ListContactsParams {
            user_id,
            tag_id: None,
            search: Some(contact_names.join(" ")),
            importance: None,
            sort_by: "created_at".into(),
            limit: 50,
            offset: 0,
        };
        contacts = business::contact::list(&conn, &p)
            .map(|(items, _)| items)
            .unwrap_or_default();
    }

    Ok(quick::parse(&text, &contacts, Utc::now()))
}