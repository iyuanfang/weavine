use crate::db::Database;
use crate::models::*;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInteractionInput {
    pub owner_id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: String,
    pub channel: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInteractionInput {
    pub id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: Option<String>,
    pub channel: Option<String>,
    pub summary: Option<String>,
}

fn row_to_interaction(row: &rusqlite::Row) -> rusqlite::Result<Interaction> {
    Ok(Interaction {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        contact_id: row.get(2)?,
        action_id: row.get(3)?,
        event_id: row.get(4)?,
        occurred_at: row.get(5)?,
        channel: row.get(6)?,
        summary: row.get(7)?,
        created_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn list_interactions(
    db: State<Database>,
    owner_id: String,
    contact_id: Option<String>,
    action_id: Option<String>,
    event_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<Interaction>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let mut sql = String::from(
        "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
         FROM Interaction WHERE ownerId = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(owner_id)];
    let mut idx = 2;

    if let Some(ref cid) = contact_id {
        sql.push_str(&format!(" AND contactId = ?{}", idx));
        param_values.push(Box::new(cid.clone()));
        idx += 1;
    }
    if let Some(ref aid) = action_id {
        sql.push_str(&format!(" AND actionId = ?{}", idx));
        param_values.push(Box::new(aid.clone()));
        idx += 1;
    }
    if let Some(ref eid) = event_id {
        sql.push_str(&format!(" AND eventId = ?{}", idx));
        param_values.push(Box::new(eid.clone()));
        idx += 1;
    }

    sql.push_str(&format!(" ORDER BY occurredAt DESC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let interactions = stmt
        .query_map(params_refs.as_slice(), row_to_interaction)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(interactions)
}

#[tauri::command]
pub fn create_interaction(
    db: State<Database>,
    input: CreateInteractionInput,
) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    conn.execute(
        "INSERT INTO Interaction \
         (id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            &id,
            &input.owner_id,
            &input.contact_id,
            &input.action_id,
            &input.event_id,
            &input.occurred_at,
            &input.channel,
            &input.summary,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let interaction = conn
        .query_row(
            "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
             FROM Interaction WHERE id = ?1",
            rusqlite::params![&id],
            row_to_interaction,
        )
        .map_err(|e| e.to_string())?;

    Ok(interaction)
}

#[tauri::command]
pub fn update_interaction(
    db: State<Database>,
    input: UpdateInteractionInput,
) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("UPDATE Interaction SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref cid) = input.contact_id {
        set_clauses.push(format!("contactId = ?{}", param_idx));
        params.push(Box::new(cid.clone()));
        param_idx += 1;
    }
    if let Some(ref aid) = input.action_id {
        set_clauses.push(format!("actionId = ?{}", param_idx));
        params.push(Box::new(aid.clone()));
        param_idx += 1;
    }
    if let Some(ref eid) = input.event_id {
        set_clauses.push(format!("eventId = ?{}", param_idx));
        params.push(Box::new(eid.clone()));
        param_idx += 1;
    }
    if let Some(ref occurred) = input.occurred_at {
        set_clauses.push(format!("occurredAt = ?{}", param_idx));
        params.push(Box::new(occurred.clone()));
        param_idx += 1;
    }
    if let Some(ref ch) = input.channel {
        set_clauses.push(format!("channel = ?{}", param_idx));
        params.push(Box::new(ch.clone()));
        param_idx += 1;
    }
    if let Some(ref sum) = input.summary {
        set_clauses.push(format!("summary = ?{}", param_idx));
        params.push(Box::new(sum.clone()));
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

    let interaction = conn
        .query_row(
            "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
             FROM Interaction WHERE id = ?1",
            rusqlite::params![&input.id],
            row_to_interaction,
        )
        .map_err(|e| e.to_string())?;

    Ok(interaction)
}

#[tauri::command]
pub fn delete_interaction(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM Interaction WHERE id = ?1",
        rusqlite::params![&id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_interaction(db: State<Database>, id: String) -> Result<Interaction, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let interaction = conn
        .query_row(
            "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
             FROM Interaction WHERE id = ?1",
            rusqlite::params![&id],
            row_to_interaction,
        )
        .map_err(|e| e.to_string())?;
    Ok(interaction)
}
