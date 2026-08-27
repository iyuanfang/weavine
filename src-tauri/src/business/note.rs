use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub(crate) fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        archived_at: row.get(4).ok(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        imported_from: row.get(7).ok(),
        imported_at: row.get(8).ok(),
    })
}

pub fn list(conn: &Connection, user_id: &str, cursor: Option<&str>) -> rusqlite::Result<(Vec<Note>, bool)> {
    let limit: i64 = 31;
    let sql = if let Some(cursor_str) = cursor {
        if let Some((cursor_at, cursor_id)) = cursor_str.split_once(',') {
            format!(
                "SELECT id, user_id, title, body, archived_at, created_at, updated_at, imported_from, imported_at \
                 FROM Note WHERE user_id = ?1 AND archived_at IS NULL \
                  AND (updated_at < ?2 OR (updated_at = ?2 AND id > ?3)) \
                 ORDER BY updated_at DESC, id ASC LIMIT ?4",
            )
        } else {
            "SELECT id, user_id, title, body, archived_at, created_at, updated_at, imported_from, imported_at \
             FROM Note WHERE user_id = ?1 AND archived_at IS NULL \
             ORDER BY updated_at DESC LIMIT ?2".to_string()
        }
    } else {
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at, imported_from, imported_at \
         FROM Note WHERE user_id = ?1 AND archived_at IS NULL \
         ORDER BY updated_at DESC LIMIT ?2".to_string()
    };
    let rows: Vec<Note> = if let Some(cursor_str) = cursor {
        if let Some((cursor_at, cursor_id)) = cursor_str.split_once(',') {
            conn.prepare(&sql)?
                .query_map(rusqlite::params![user_id, cursor_at, cursor_id, limit], row_to_note)?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            conn.prepare(&sql)?
                .query_map(rusqlite::params![user_id, limit], row_to_note)?
                .filter_map(|r| r.ok())
                .collect()
        }
    } else {
        conn.prepare(&sql)?
            .query_map(rusqlite::params![user_id, limit], row_to_note)?
            .filter_map(|r| r.ok())
            .collect()
    };
    let has_more = rows.len() >= limit as usize;
    let items: Vec<Note> = rows.into_iter().take(limit as usize - 1).collect();
    Ok((items, has_more))
}

pub fn get(conn: &Connection, user_id: &str, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at, imported_from, imported_at \
         FROM Note WHERE id = ?1 AND user_id = ?2 AND archived_at IS NULL",
    )?;
    stmt.query_row(params![id, user_id], row_to_note).optional()
}

fn now_str() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn sync_note_entities(
    conn: &Connection,
    note_id: &str,
    user_id: &str,
    links: &[NoteEntityLink],
) -> rusqlite::Result<()> {
    for link in links {
        conn.execute(
            "INSERT OR IGNORE INTO NoteEntity (id, note_id, user_id, entity_type, entity_id, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::new_v4().to_string(),
                note_id,
                user_id,
                link.entity_type,
                link.entity_id,
                now_str(),
            ],
        )?;
    }
    Ok(())
}

const ALLOWED_ENTITY_TYPES: &[&str] = &["contact", "project", "event", "action", "interaction"];

fn validate_entity_links(links: &[NoteEntityLink]) -> Result<(), String> {
    for link in links {
        if !ALLOWED_ENTITY_TYPES.contains(&link.entity_type.as_str()) {
            return Err(format!("不支持的关联实体类型: {}", link.entity_type));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, user_id: &str, input: &CreateNoteInput) -> rusqlite::Result<Note> {
    validate_entity_links(&input.entity_links)
        .map_err(|m| rusqlite::Error::ToSqlConversionFailure(m.into()))?;
    let id = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO Note (id, user_id, title, body, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, user_id, input.title, input.body, now],
    )?;
    sync_note_entities(conn, &id, user_id, &input.entity_links)?;
    get(conn, user_id, &id)?.ok_or_else(|| {
        rusqlite::Error::QueryReturnedNoRows
    })
}

pub fn update(conn: &Connection, user_id: &str, id: &str, input: &UpdateNoteInput) -> rusqlite::Result<Option<Note>> {
    let now = now_str();
    let changed = conn.execute(
        "UPDATE Note SET \
            title      = COALESCE(?3, title), \
            body       = COALESCE(?4, body),  \
            updated_at = ?5 \
          WHERE id = ?1 AND user_id = ?2",
        params![id, user_id, input.title, input.body, now],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    if let Some(links) = &input.entity_links {
        validate_entity_links(links)
            .map_err(|m| rusqlite::Error::ToSqlConversionFailure(m.into()))?;
        conn.execute("DELETE FROM NoteEntity WHERE note_id = ?1", params![id])?;
        sync_note_entities(conn, id, user_id, links)?;
    }
    get(conn, user_id, id)
}

pub fn delete(conn: &Connection, user_id: &str, id: &str) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "DELETE FROM Note WHERE id = ?1 AND user_id = ?2",
        params![id, user_id],
    )?;
    Ok(n > 0)
}

pub fn list_backlinks(
    conn: &Connection,
    user_id: &str,
    entity_type: &str,
    entity_id: &str,
) -> rusqlite::Result<Vec<NoteBacklink>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, substr(n.body, 1, 200), n.updated_at \
         FROM Note n INNER JOIN NoteEntity ne ON ne.note_id = n.id \
         WHERE ne.user_id = ?1 AND ne.entity_type = ?2 AND ne.entity_id = ?3 \
           AND n.archived_at IS NULL \
         ORDER BY n.updated_at DESC",
    )?;
    let rows = stmt
        .query_map(params![user_id, entity_type, entity_id], |row| {
            Ok(NoteBacklink {
                note_id: row.get(0)?,
                note_title: row.get(1)?,
                snippet: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect::<Vec<NoteBacklink>>();
    Ok(rows)
}

pub fn list_note_entities(
    conn: &Connection,
    user_id: &str,
    note_id: &str,
) -> rusqlite::Result<Vec<NoteEntityLink>> {
    let mut stmt = conn.prepare(
        "SELECT entity_type, entity_id FROM NoteEntity \
         WHERE note_id = ?1 AND user_id = ?2 \
         ORDER BY entity_type, entity_id",
    )?;
    let rows = stmt
        .query_map(params![note_id, user_id], |row| {
            Ok(NoteEntityLink {
                entity_type: row.get(0)?,
                entity_id: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect::<Vec<NoteEntityLink>>();
    Ok(rows)
}