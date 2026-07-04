use crate::models::*;
use rusqlite::Connection;

pub(crate) fn row_to_setting(row: &rusqlite::Row) -> rusqlite::Result<Setting> {
    Ok(Setting {
        id: row.get(0)?,
        user_id: row.get(1)?,
        key: row.get(2)?,
        value: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

pub fn list(conn: &Connection, user_id: &str) -> rusqlite::Result<Vec<Setting>> {
    let mut stmt = conn.prepare(
        "SELECT id, ownerId, key, value, updatedAt FROM Setting WHERE ownerId = ?1 ORDER BY key ASC",
    )?;

    let settings = stmt
        .query_map(rusqlite::params![user_id], row_to_setting)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(settings)
}

pub fn upsert(conn: &Connection, user_id: &str, key: &str, value: &str) -> rusqlite::Result<Setting> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    conn.execute(
        "INSERT INTO Setting (id, ownerId, key, value, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(ownerId, key) DO UPDATE SET value = ?4, updatedAt = ?5",
        rusqlite::params![
            &uuid::Uuid::new_v4().to_string(),
            user_id,
            key,
            value,
            &now,
        ],
    )?;

    conn.query_row(
        "SELECT id, ownerId, key, value, updatedAt FROM Setting WHERE ownerId = ?1 AND key = ?2",
        rusqlite::params![user_id, key],
        row_to_setting,
    )
}

pub fn delete(conn: &Connection, user_id: &str, key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM Setting WHERE ownerId = ?1 AND key = ?2",
        rusqlite::params![user_id, key],
    )?;
    Ok(())
}
