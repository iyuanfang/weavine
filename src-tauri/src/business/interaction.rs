use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_interaction(row: &rusqlite::Row) -> rusqlite::Result<Interaction> {
    Ok(Interaction {
        id: row.get(0)?,
        user_id: row.get(1)?,
        contact_id: row.get(2)?,
        action_id: row.get(3)?,
        event_id: row.get(4)?,
        occurred_at: row.get(5)?,
        channel: row.get(6)?,
        summary: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn list(
    conn: &Connection,
    user_id: &str,
    contact_id: Option<&str>,
    action_id: Option<&str>,
    event_id: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Interaction>> {
    let limit = limit.unwrap_or(50);

    let mut sql = String::from(
        "SELECT id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM Interaction WHERE user_id = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(user_id.to_string())];
    let mut idx = 2;

    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND contact_id = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(aid) = action_id {
        sql.push_str(&format!(" AND action_id = ?{}", idx));
        param_values.push(Box::new(aid.to_string()));
        idx += 1;
    }
    if let Some(eid) = event_id {
        sql.push_str(&format!(" AND event_id = ?{}", idx));
        param_values.push(Box::new(eid.to_string()));
        idx += 1;
    }

    sql.push_str(&format!(" ORDER BY occurred_at DESC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let interactions = stmt
        .query_map(params_refs.as_slice(), row_to_interaction)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(interactions)
}

pub fn create(conn: &Connection, input: &CreateInteractionInput) -> rusqlite::Result<Interaction> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    conn.execute(
        "INSERT INTO Interaction \
         (id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.contact_id,
            &input.action_id,
            &input.event_id,
            &input.occurred_at,
            &input.channel,
            &input.summary,
            &now,
        ],
    )?;

    conn.query_row(
        "SELECT id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM Interaction WHERE id = ?1",
        rusqlite::params![&id],
        row_to_interaction,
    )
}

pub fn update(conn: &Connection, input: &UpdateInteractionInput) -> rusqlite::Result<Interaction> {
    let mut sql = String::from("UPDATE Interaction SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref cid) = input.contact_id {
        set_clauses.push(format!("contact_id = ?{}", param_idx));
        params.push(Box::new(cid.clone()));
        param_idx += 1;
    }
    if let Some(ref aid) = input.action_id {
        set_clauses.push(format!("action_id = ?{}", param_idx));
        params.push(Box::new(aid.clone()));
        param_idx += 1;
    }
    if let Some(ref eid) = input.event_id {
        set_clauses.push(format!("event_id = ?{}", param_idx));
        params.push(Box::new(eid.clone()));
        param_idx += 1;
    }
    if let Some(ref occurred) = input.occurred_at {
        set_clauses.push(format!("occurred_at = ?{}", param_idx));
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

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    conn.query_row(
        "SELECT id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM Interaction WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_interaction,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Interaction WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Interaction> {
    conn.query_row(
        "SELECT id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM Interaction WHERE id = ?1",
        rusqlite::params![id],
        row_to_interaction,
    )
}
