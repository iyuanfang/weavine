use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagInput {
    pub owner_id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagInput {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

fn row_to_tag(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_tags(db: State<Database>, owner_id: String) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, ownerId, name, color, createdAt FROM Tag WHERE ownerId = ?1 ORDER BY name ASC",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map(rusqlite::params![&owner_id], row_to_tag)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

#[tauri::command]
pub fn create_tag(
    db: State<Database>,
    input: CreateTagInput,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO Tag (id, ownerId, name, color) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![&id, &input.owner_id, &input.name, &input.color],
    )
    .map_err(|e| e.to_string())?;

    let tag = conn
        .query_row(
            "SELECT id, ownerId, name, color, createdAt FROM Tag WHERE id = ?1",
            rusqlite::params![&id],
            row_to_tag,
        )
        .map_err(|e| e.to_string())?;

    Ok(tag)
}

#[tauri::command]
pub fn update_tag(
    db: State<Database>,
    input: UpdateTagInput,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("UPDATE Tag SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref n) = input.name {
        set_clauses.push(format!("name = ?{}", param_idx));
        params.push(Box::new(n.clone()));
        param_idx += 1;
    }
    if let Some(ref c) = input.color {
        set_clauses.push(format!("color = ?{}", param_idx));
        params.push(Box::new(c.clone()));
        param_idx += 1;
    }

    if set_clauses.is_empty() {
        return Err("No fields to update".to_string());
    }

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())
            .map_err(|e| e.to_string())?;
    }

    let tag = conn
        .query_row(
            "SELECT id, ownerId, name, color, createdAt FROM Tag WHERE id = ?1",
            rusqlite::params![&input.id],
            row_to_tag,
        )
        .map_err(|e| e.to_string())?;

    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM Tag WHERE id = ?1", rusqlite::params![&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
