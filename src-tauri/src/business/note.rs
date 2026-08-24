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
    })
}

pub fn list(conn: &Connection, user_id: &str, include_archived: bool) -> rusqlite::Result<Vec<Note>> {
    let sql = if include_archived {
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM Note WHERE user_id = ?1 ORDER BY updated_at DESC"
    } else {
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM Note WHERE user_id = ?1 AND archived_at IS NULL ORDER BY updated_at DESC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([user_id], row_to_note)?
        .filter_map(|r| r.ok())
        .collect::<Vec<Note>>();
    Ok(rows)
}

pub fn get(conn: &Connection, user_id: &str, id: &str) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM Note WHERE id = ?1 AND user_id = ?2",
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
    body: &str,
) -> rusqlite::Result<()> {
    let refs = parse_wikilinks(body);
    for (entity_type, title) in refs {
        let entity_id: Option<String> = match entity_type.as_str() {
            "contact" => conn
                .query_row(
                    "SELECT id FROM Contact WHERE user_id = ?1 AND (nickname = ?2 OR name = ?2) LIMIT 1",
                    params![user_id, title],
                    |r| r.get(0),
                )
                .optional()?,
            "project" => conn
                .query_row(
                    "SELECT id FROM Project WHERE user_id = ?1 AND title = ?2 LIMIT 1",
                    params![user_id, title],
                    |r| r.get(0),
                )
                .optional()?,
            "action" => conn
                .query_row(
                    "SELECT id FROM Action WHERE user_id = ?1 AND title = ?2 LIMIT 1",
                    params![user_id, title],
                    |r| r.get(0),
                )
                .optional()?,
            "event" => conn
                .query_row(
                    "SELECT id FROM Event WHERE user_id = ?1 AND title = ?2 LIMIT 1",
                    params![user_id, title],
                    |r| r.get(0),
                )
                .optional()?,
            _ => None,
        };
        if let Some(eid) = entity_id {
            conn.execute(
                "INSERT OR IGNORE INTO NoteEntity (id, note_id, user_id, entity_type, entity_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![Uuid::new_v4().to_string(), note_id, user_id, entity_type, eid, now_str()],
            )?;
        }
    }
    Ok(())
}

fn parse_wikilinks(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(end_rel) = body[i + 2..].find("]]") {
                let inner = &body[i + 2..i + 2 + end_rel];
                if let Some(colon) = inner.find(':') {
                    let kind = inner[..colon].to_ascii_lowercase();
                    let title = inner[colon + 1..].trim().to_string();
                    if matches!(kind.as_str(), "contact" | "project" | "action" | "event")
                        && !title.is_empty()
                    {
                        out.push((kind, title));
                    }
                }
                i += 2 + end_rel + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

pub fn create(conn: &Connection, input: &CreateNoteInput) -> rusqlite::Result<Note> {
    let id = Uuid::new_v4().to_string();
    let now = now_str();
    conn.execute(
        "INSERT INTO Note (id, user_id, title, body, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, input.user_id, input.title, input.body, now],
    )?;
    sync_note_entities(conn, &id, &input.user_id, &input.body)?;
    get(conn, &input.user_id, &id)?.ok_or_else(|| {
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
    if input.body.is_some() {
        conn.execute("DELETE FROM NoteEntity WHERE note_id = ?1", params![id])?;
        if let Some(note) = get(conn, user_id, id)? {
            sync_note_entities(conn, id, user_id, &note.body)?;
        }
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
        "SELECT n.id, n.title, substr(n.body, 1, 200) \
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
            })
        })?
        .filter_map(|r| r.ok())
        .collect::<Vec<NoteBacklink>>();
    Ok(rows)
}