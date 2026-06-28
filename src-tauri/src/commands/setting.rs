use crate::db::Database;
use crate::models::*;
use tauri::State;

fn row_to_setting(row: &rusqlite::Row) -> rusqlite::Result<Setting> {
    Ok(Setting {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        key: row.get(2)?,
        value: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_settings(
    db: State<Database>,
    owner_id: String,
) -> Result<Vec<Setting>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, ownerId, key, value, updatedAt FROM Setting WHERE ownerId = ?1 ORDER BY key ASC",
        )
        .map_err(|e| e.to_string())?;

    let settings = stmt
        .query_map(rusqlite::params![&owner_id], row_to_setting)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(settings)
}

#[tauri::command]
pub fn upsert_setting(
    db: State<Database>,
    owner_id: String,
    key: String,
    value: String,
) -> Result<Setting, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    conn.execute(
        "INSERT INTO Setting (id, ownerId, key, value, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(ownerId, key) DO UPDATE SET value = ?4, updatedAt = ?5",
        rusqlite::params![
            &uuid::Uuid::new_v4().to_string(),
            &owner_id,
            &key,
            &value,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let setting = conn
        .query_row(
            "SELECT id, ownerId, key, value, updatedAt FROM Setting WHERE ownerId = ?1 AND key = ?2",
            rusqlite::params![&owner_id, &key],
            row_to_setting,
        )
        .map_err(|e| e.to_string())?;

    Ok(setting)
}

#[tauri::command]
pub fn delete_setting(
    db: State<Database>,
    owner_id: String,
    key: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM Setting WHERE ownerId = ?1 AND key = ?2",
        rusqlite::params![&owner_id, &key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
