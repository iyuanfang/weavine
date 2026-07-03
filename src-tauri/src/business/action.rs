use crate::commands::action::{CreateActionInput, UpdateActionInput};
use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_action(row: &rusqlite::Row) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        status: row.get(4)?,
        priority: row.get(5)?,
        category: row.get(6)?,
        due_at: row.get(7)?,
        contact_id: row.get(8)?,
        project_id: row.get(9)?,
        completed_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

pub fn list(
    conn: &Connection,
    owner_id: &str,
    status: Option<&str>,
    contact_id: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Action>> {
    let limit = limit.unwrap_or(100);

    let mut sql = String::from(
        "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, projectId, completedAt, createdAt, updatedAt \
         FROM Action WHERE ownerId = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(owner_id.to_string())];
    let mut idx = 2;

    if let Some(s) = status {
        sql.push_str(&format!(" AND status = ?{}", idx));
        param_values.push(Box::new(s.to_string()));
        idx += 1;
    }
    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND contactId = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }

    sql.push_str(&format!(" ORDER BY dueAt ASC, priority DESC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let actions = stmt
        .query_map(params_refs.as_slice(), row_to_action)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(actions)
}

pub fn create(conn: &Connection, input: &CreateActionInput) -> rusqlite::Result<Action> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let status = input.status.clone().unwrap_or_else(|| "inbox".to_string());
    let priority = input.priority.unwrap_or(0);

    conn.execute(
        "INSERT INTO Action \
         (id, ownerId, title, description, status, priority, category, dueAt, contactId, projectId, completedAt, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            &id,
            &input.owner_id,
            &input.title,
            &input.description,
            &status,
            &priority,
            &input.category,
            &input.due_at,
            &input.contact_id,
            None::<String>,
            None::<String>,
            &now,
            &now,
        ],
    )?;

    conn.query_row(
        "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, projectId, completedAt, createdAt, updatedAt \
         FROM Action WHERE id = ?1",
        rusqlite::params![&id],
        row_to_action,
    )
}

pub fn update(conn: &Connection, input: &UpdateActionInput) -> rusqlite::Result<Action> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut sql = String::from("UPDATE Action SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.title {
        set_clauses.push(format!("title = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref d) = input.description {
        set_clauses.push(format!("description = ?{}", param_idx));
        params.push(Box::new(d.clone()));
        param_idx += 1;
    }
    if let Some(ref s) = input.status {
        set_clauses.push(format!("status = ?{}", param_idx));
        params.push(Box::new(s.clone()));
        param_idx += 1;
    }
    if let Some(ref p) = input.priority {
        set_clauses.push(format!("priority = ?{}", param_idx));
        params.push(Box::new(*p));
        param_idx += 1;
    }
    if let Some(ref c) = input.category {
        set_clauses.push(format!("category = ?{}", param_idx));
        params.push(Box::new(c.clone()));
        param_idx += 1;
    }
    if let Some(ref da) = input.due_at {
        set_clauses.push(format!("dueAt = ?{}", param_idx));
        params.push(Box::new(da.clone()));
        param_idx += 1;
    }
    if let Some(ref cid) = input.contact_id {
        set_clauses.push(format!("contactId = ?{}", param_idx));
        params.push(Box::new(cid.clone()));
        param_idx += 1;
    }
    if let Some(ref ca) = input.completed_at {
        set_clauses.push(format!("completedAt = ?{}", param_idx));
        params.push(Box::new(ca.clone()));
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
        "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, projectId, completedAt, createdAt, updatedAt \
         FROM Action WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_action,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Action WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Action> {
    conn.query_row(
        "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, projectId, completedAt, createdAt, updatedAt \
         FROM Action WHERE id = ?1",
        rusqlite::params![id],
        row_to_action,
    )
}
