use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReminderInput {
    pub owner_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub trigger_at: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateReminderInput {
    pub id: String,
    pub trigger_at: Option<String>,
    pub kind: Option<String>,
    pub dispatched: Option<bool>,
    pub dismissed: Option<bool>,
}

fn row_to_reminder(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        contact_id: row.get(2)?,
        event_id: row.get(3)?,
        trigger_at: row.get(4)?,
        kind: row.get(5)?,
        dispatched: row.get::<_, i64>(6)? != 0,
        dismissed: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn list_reminders(
    db: State<Database>,
    owner_id: String,
    contact_id: Option<String>,
    event_id: Option<String>,
    include_dismissed: Option<bool>,
    limit: Option<i64>,
) -> Result<Vec<Reminder>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(100);
    let include_dismissed = include_dismissed.unwrap_or(false);

    let mut sql = String::from(
        "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
         FROM Reminder WHERE ownerId = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(owner_id)];
    let mut idx = 2;

    if let Some(ref cid) = contact_id {
        sql.push_str(&format!(" AND contactId = ?{}", idx));
        param_values.push(Box::new(cid.clone()));
        idx += 1;
    }
    if let Some(ref eid) = event_id {
        sql.push_str(&format!(" AND eventId = ?{}", idx));
        param_values.push(Box::new(eid.clone()));
        idx += 1;
    }
    if !include_dismissed {
        sql.push_str(" AND dismissed = 0");
    }

    sql.push_str(&format!(" ORDER BY triggerAt ASC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let reminders = stmt
        .query_map(params_refs.as_slice(), row_to_reminder)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(reminders)
}

#[tauri::command]
pub fn create_reminder(
    db: State<Database>,
    input: CreateReminderInput,
) -> Result<Reminder, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let kind = input.kind.unwrap_or_else(|| "event".to_string());

    conn.execute(
        "INSERT INTO Reminder \
         (id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7)",
        rusqlite::params![
            &id,
            &input.owner_id,
            &input.contact_id,
            &input.event_id,
            &input.trigger_at,
            &kind,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let reminder = conn
        .query_row(
            "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
             FROM Reminder WHERE id = ?1",
            rusqlite::params![&id],
            row_to_reminder,
        )
        .map_err(|e| e.to_string())?;

    Ok(reminder)
}

#[tauri::command]
pub fn update_reminder(
    db: State<Database>,
    input: UpdateReminderInput,
) -> Result<Reminder, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("UPDATE Reminder SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.trigger_at {
        set_clauses.push(format!("triggerAt = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref k) = input.kind {
        set_clauses.push(format!("kind = ?{}", param_idx));
        params.push(Box::new(k.clone()));
        param_idx += 1;
    }
    if let Some(disp) = input.dispatched {
        set_clauses.push(format!("dispatched = ?{}", param_idx));
        params.push(Box::new(if disp { 1i64 } else { 0i64 }));
        param_idx += 1;
    }
    if let Some(dis) = input.dismissed {
        set_clauses.push(format!("dismissed = ?{}", param_idx));
        params.push(Box::new(if dis { 1i64 } else { 0i64 }));
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

    let reminder = conn
        .query_row(
            "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
             FROM Reminder WHERE id = ?1",
            rusqlite::params![&input.id],
            row_to_reminder,
        )
        .map_err(|e| e.to_string())?;

    Ok(reminder)
}

#[tauri::command]
pub fn delete_reminder(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM Reminder WHERE id = ?1", rusqlite::params![&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn dismiss_reminder(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE Reminder SET dismissed = 1 WHERE id = ?1",
        rusqlite::params![&id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
