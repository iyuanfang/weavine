use crate::models::*;
use rusqlite::{params, Connection};
use uuid::Uuid;

fn row_to_entity_link(row: &rusqlite::Row) -> rusqlite::Result<EntityLink> {
    Ok(EntityLink {
        id: row.get(0)?,
        user_id: row.get(1)?,
        from_type: row.get(2)?,
        from_id: row.get(3)?,
        to_type: row.get(4)?,
        to_id: row.get(5)?,
        relation_type: row.get(6)?,
        role: row.get(7)?,
        label: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn sync_main_participant(conn: &Connection, event_id: &str, user_id: &str) -> rusqlite::Result<()> {
    let first: Option<String> = conn
        .query_row(
            "SELECT to_id FROM EntityLink \
             WHERE user_id = ?1 AND from_type='event' AND from_id = ?2 \
               AND relation_type='participated' \
             ORDER BY created_at ASC LIMIT 1",
            params![user_id, event_id],
            |r| r.get(0),
        )
        .ok();
    conn.execute(
        "UPDATE \"Event\" SET contact_id = ?1, updated_at = CURRENT_TIMESTAMP \
         WHERE id = ?2 AND user_id = ?3",
        params![first, event_id, user_id],
    )?;
    Ok(())
}

fn validate_role(role: &str) -> bool {
    matches!(role, "organizer" | "participant" | "referred" | "mentioned")
}

pub fn add(
    conn: &Connection,
    event_id: &str,
    contact_id: &str,
    role: &str,
) -> rusqlite::Result<EntityLink> {
    let user_id: String = conn
        .query_row(
            "SELECT user_id FROM \"Event\" WHERE id = ?1 AND archived_at IS NULL",
            params![event_id],
            |r| r.get(0),
        )
        .map_err(|_| rusqlite::Error::QueryReturnedNoRows)?;

    let contact_owner: Option<String> = conn
        .query_row(
            "SELECT user_id FROM \"Contact\" WHERE id = ?1",
            params![contact_id],
            |r| r.get(0),
        )
        .ok();
    match contact_owner {
        Some(c) if c == user_id => {}
        _ => {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "contact {contact_id} not found or owner mismatch"
            )));
        }
    }

    let role = if validate_role(role) { role } else { "participant" };
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO EntityLink \
            (id, user_id, from_type, from_id, to_type, to_id, relation_type, role) \
         VALUES (?1, ?2, 'event', ?3, 'contact', ?4, 'participated', ?5) \
         ON CONFLICT(user_id, from_type, from_id, to_type, to_id, relation_type) \
         DO UPDATE SET role = excluded.role",
        params![id, user_id, event_id, contact_id, role],
    )?;

    sync_main_participant(conn, event_id, &user_id)?;

    conn.query_row(
        "SELECT id, user_id, from_type, from_id, to_type, to_id, relation_type, role, label, created_at \
         FROM EntityLink WHERE user_id = ?1 AND from_type='event' AND from_id = ?2 \
           AND to_id = ?3 AND relation_type='participated'",
        params![user_id, event_id, contact_id],
        row_to_entity_link,
    )
}

pub fn list(conn: &Connection, event_id: &str, user_id: &str) -> rusqlite::Result<Vec<EntityLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, from_type, from_id, to_type, to_id, relation_type, role, label, created_at \
         FROM EntityLink \
         WHERE user_id = ?1 AND from_type='event' AND from_id = ?2 \
           AND relation_type='participated' \
         ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![user_id, event_id], row_to_entity_link)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_role(
    conn: &Connection,
    event_id: &str,
    contact_id: &str,
    role: &str,
    user_id: &str,
) -> rusqlite::Result<()> {
    if !validate_role(role) {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "invalid role {role}"
        )));
    }
    let changed = conn.execute(
        "UPDATE EntityLink SET role = ?1 \
         WHERE user_id = ?2 AND from_type='event' AND from_id = ?3 \
           AND to_id = ?4 AND relation_type='participated'",
        params![role, user_id, event_id, contact_id],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn remove(
    conn: &Connection,
    event_id: &str,
    contact_id: &str,
    user_id: &str,
) -> rusqlite::Result<()> {
    let changed = conn.execute(
        "DELETE FROM EntityLink \
         WHERE user_id = ?1 AND from_type='event' AND from_id = ?2 \
           AND to_id = ?3 AND relation_type='participated'",
        params![user_id, event_id, contact_id],
    )?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    sync_main_participant(conn, event_id, user_id)?;
    Ok(())
}