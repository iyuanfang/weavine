use crate::commands::event::{CreateEventInput, UpdateEventInput};
use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        title: row.get(2)?,
        event_type: row.get(3)?,
        start_at: row.get(4)?,
        end_at: row.get(5)?,
        location: row.get(6)?,
        notes: row.get(7)?,
        contact_id: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn list(
    conn: &Connection,
    owner_id: &str,
    contact_id: Option<&str>,
    start_after: Option<&str>,
    start_before: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Event>> {
    let limit = limit.unwrap_or(100);

    let mut sql = String::from(
        "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
         FROM Event WHERE ownerId = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(owner_id.to_string())];
    let mut idx = 2;

    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND contactId = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(after) = start_after {
        sql.push_str(&format!(" AND startAt >= ?{}", idx));
        param_values.push(Box::new(after.to_string()));
        idx += 1;
    }
    if let Some(before) = start_before {
        sql.push_str(&format!(" AND startAt <= ?{}", idx));
        param_values.push(Box::new(before.to_string()));
        idx += 1;
    }

    sql.push_str(&format!(" ORDER BY startAt ASC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let events = stmt
        .query_map(params_refs.as_slice(), row_to_event)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}

pub fn create(conn: &Connection, input: &CreateEventInput) -> rusqlite::Result<Event> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    conn.execute(
        "INSERT INTO Event \
         (id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            &id,
            &input.owner_id,
            &input.title,
            &input.event_type,
            &input.start_at,
            &input.end_at,
            &input.location,
            &input.notes,
            &input.contact_id,
            &now,
            &now,
        ],
    )?;

    conn.query_row(
        "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
         FROM Event WHERE id = ?1",
        rusqlite::params![&id],
        row_to_event,
    )
}

pub fn update(conn: &Connection, input: &UpdateEventInput) -> rusqlite::Result<Event> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut sql = String::from("UPDATE Event SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.title {
        set_clauses.push(format!("title = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref et) = input.event_type {
        set_clauses.push(format!("type = ?{}", param_idx));
        params.push(Box::new(et.clone()));
        param_idx += 1;
    }
    if let Some(ref sa) = input.start_at {
        set_clauses.push(format!("startAt = ?{}", param_idx));
        params.push(Box::new(sa.clone()));
        param_idx += 1;
    }
    if let Some(ref ea) = input.end_at {
        set_clauses.push(format!("endAt = ?{}", param_idx));
        params.push(Box::new(ea.clone()));
        param_idx += 1;
    }
    if let Some(ref loc) = input.location {
        set_clauses.push(format!("location = ?{}", param_idx));
        params.push(Box::new(loc.clone()));
        param_idx += 1;
    }
    if let Some(ref n) = input.notes {
        set_clauses.push(format!("notes = ?{}", param_idx));
        params.push(Box::new(n.clone()));
        param_idx += 1;
    }
    if let Some(ref cid) = input.contact_id {
        set_clauses.push(format!("contactId = ?{}", param_idx));
        params.push(Box::new(cid.clone()));
        param_idx += 1;
    }

    set_clauses.push(format!("updatedAt = ?{}", param_idx));
    params.push(Box::new(now));
    param_idx += 1;

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    conn.query_row(
        "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
         FROM Event WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_event,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Event WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Event> {
    conn.query_row(
        "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
         FROM Event WHERE id = ?1",
        rusqlite::params![id],
        row_to_event,
    )
}

pub fn get_upcoming(conn: &Connection, owner_id: &str, limit: Option<i64>) -> rusqlite::Result<Vec<Event>> {
    let limit = limit.unwrap_or(5);
    let now_iso = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut stmt = conn.prepare(
        "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
         FROM Event WHERE ownerId = ?1 AND startAt >= ?2 \
         ORDER BY startAt ASC LIMIT ?3",
    )?;

    let events = stmt
        .query_map(rusqlite::params![owner_id, &now_iso, &limit], row_to_event)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}
