use crate::business::reminder as reminder_biz;
use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

const EVENT_COLS: &str =
    "Event.id, Event.user_id, Event.title, Event.event_type, Event.start_at, Event.end_at, Event.location, Event.contact_id, Event.project_id, Event.reminder_lead_minutes, Event.archived_at, Event.created_at, Event.updated_at, Event.deleted_at";

const EVENT_REL_COLS: &str = ", c.nickname AS contact_nickname, p.title AS project_title";

const EVENT_JOINS: &str = " LEFT JOIN \"Contact\" c ON c.id = Event.contact_id AND c.user_id = Event.user_id \
                            LEFT JOIN \"Project\" p ON p.id = Event.project_id AND p.user_id = Event.user_id";

pub(crate) fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        event_type: row.get(3)?,
        start_at: row.get(4)?,
        end_at: row.get(5)?,
        location: row.get(6)?,
        contact_id: row.get(7)?,
        project_id: row.get(8)?,
        reminder_lead_minutes: row.get(9)?,
        archived_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        deleted_at: row.get(13).ok(),
        contact_nickname: row.get(14)?,
        project_title: row.get(15)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn list(
    conn: &Connection,
    user_id: &str,
    contact_id: Option<&str>,
    project_id: Option<&str>,
    start_after: Option<&str>,
    start_before: Option<&str>,
    archived: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Event>> {
    let limit = limit.unwrap_or(100);

    let mut sql = format!("SELECT {EVENT_COLS}{EVENT_REL_COLS} FROM Event{EVENT_JOINS} WHERE Event.user_id = ?1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(user_id.to_string())];
    let mut idx = 2;

    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND Event.contact_id = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(pid) = project_id {
        sql.push_str(&format!(" AND Event.project_id = ?{}", idx));
        param_values.push(Box::new(pid.to_string()));
        idx += 1;
    }
    if let Some(after) = start_after {
        sql.push_str(&format!(" AND Event.start_at >= ?{}", idx));
        param_values.push(Box::new(after.to_string()));
        idx += 1;
    }
    if let Some(before) = start_before {
        sql.push_str(&format!(" AND Event.start_at <= ?{}", idx));
        param_values.push(Box::new(before.to_string()));
        idx += 1;
    }
    match archived {
        Some(v) if v == "true" || v == "1" => {
            sql.push_str(" AND Event.archived_at IS NOT NULL");
        }
        Some("all") => {}
        _ => {
            sql.push_str(" AND Event.archived_at IS NULL");
        }
    }
    sql.push_str(" AND Event.deleted_at IS NULL");

    sql.push_str(&format!(" ORDER BY Event.start_at ASC LIMIT ?{}", idx));
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
         (id, user_id, title, event_type, start_at, end_at, location, contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.title,
            &input.event_type,
            &input.start_at,
            &input.end_at,
            &input.location,
            &input.contact_id,
            input.project_id.as_deref(),
            &input.reminder_lead_minutes,
            None::<String>,
            &now,
            &now,
        ],
    )?;

    let event = conn.query_row(
        &format!("SELECT {EVENT_COLS}{EVENT_REL_COLS} FROM Event{EVENT_JOINS} WHERE Event.id = ?1"),
        rusqlite::params![&id],
        row_to_event,
    )?;

    if let Err(e) = reminder_biz::sync_event_reminder(conn, &event) {
        eprintln!("[event] reminder sync failed: {e}");
    }

    Ok(event)
}

pub fn update(conn: &Connection, input: &UpdateEventInput) -> rusqlite::Result<Event> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let prev_archived_at: Option<String> = conn
        .query_row(
            "SELECT archived_at FROM Event WHERE id = ?1",
            rusqlite::params![&input.id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

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
        set_clauses.push(format!("event_type = ?{}", param_idx));
        params.push(Box::new(et.clone()));
        param_idx += 1;
    }
    if let Some(ref sa) = input.start_at {
        set_clauses.push(format!("start_at = ?{}", param_idx));
        params.push(Box::new(sa.clone()));
        param_idx += 1;
    }
    if let Some(ref ea) = input.end_at {
        set_clauses.push(format!("end_at = ?{}", param_idx));
        params.push(Box::new(ea.clone()));
        param_idx += 1;
    }
    if let Some(ref loc) = input.location {
        set_clauses.push(format!("location = ?{}", param_idx));
        params.push(Box::new(loc.clone()));
        param_idx += 1;
    }
    if let Some(ref cid) = input.contact_id {
        set_clauses.push(format!("contact_id = ?{}", param_idx));
        params.push(Box::new(cid.clone()));
        param_idx += 1;
    }
    if let Some(ref pid) = input.project_id {
        set_clauses.push(format!("project_id = ?{}", param_idx));
        params.push(Box::new(pid.clone()));
        param_idx += 1;
    }
    if let Some(rlm) = input.reminder_lead_minutes {
        set_clauses.push(format!("reminder_lead_minutes = ?{}", param_idx));
        params.push(Box::new(rlm));
        param_idx += 1;
    }
    if let Some(ref aa) = input.archived_at {
        set_clauses.push(format!("archived_at = ?{}", param_idx));
        params.push(Box::new(aa.clone()));
        param_idx += 1;
    }

    set_clauses.push(format!("updated_at = ?{}", param_idx));
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

    let event = conn.query_row(
        &format!("SELECT {EVENT_COLS}{EVENT_REL_COLS} FROM Event{EVENT_JOINS} WHERE Event.id = ?1"),
        rusqlite::params![&input.id],
        row_to_event,
    )?;

    // Archive hook: synthesize an Interaction when archived_at transitions
    // None → Some. occurred_at = event.end_at when set, else the archived_at
    // timestamp. NoteEntity rows pointing at the event are duplicated to
    // point at the new interaction so note↔event and note↔interaction
    // traversals remain intact.
    let new_archived_at = event.archived_at.clone().filter(|s| !s.is_empty());
    let was_unarchived = prev_archived_at.is_none() || prev_archived_at.as_deref() == Some("");
    if was_unarchived && new_archived_at.is_some() {
        let event_user_id = event.user_id.clone();
        let occurred_at = event
            .end_at
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| new_archived_at.clone())
            .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
        let iid = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        conn.execute(
            "INSERT INTO Interaction \
             (id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, source, source_ref, created_at) \
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, NULL, ?6, 'archive', ?4, ?7)",
            rusqlite::params![
                &iid,
                &event_user_id,
                event.contact_id.as_deref().filter(|s| !s.is_empty()),
                &input.id,
                &occurred_at,
                &event.title,
                &created_at,
            ],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO NoteEntity (id, note_id, user_id, entity_type, entity_id, created_at) \
             SELECT lower(hex(randomblob(16))), ne.note_id, ne.user_id, 'interaction', ?1, ?2 \
             FROM NoteEntity ne \
             WHERE ne.user_id = ?3 AND ne.entity_type = 'event' AND ne.entity_id = ?4",
            rusqlite::params![&iid, &created_at, &event_user_id, &input.id],
        )?;
    }

    if let Err(e) = reminder_biz::sync_event_reminder(conn, &event) {
        eprintln!("[event] reminder sync failed: {e}");
    }

    Ok(event)
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    conn.execute(
        "UPDATE Event SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        rusqlite::params![&now, id],
    )?;
    conn.execute(
        "UPDATE Reminder SET deleted_at = ?1, updated_at = ?1 WHERE event_id = ?2 AND deleted_at IS NULL",
        rusqlite::params![&now, id],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Event> {
    conn.query_row(
        &format!("SELECT {EVENT_COLS}{EVENT_REL_COLS} FROM Event{EVENT_JOINS} WHERE Event.id = ?1 AND Event.deleted_at IS NULL"),
        rusqlite::params![&id],
        row_to_event,
    )
}

pub fn get_upcoming(conn: &Connection, user_id: &str, limit: Option<i64>) -> rusqlite::Result<Vec<Event>> {
    let limit = limit.unwrap_or(5);
    let now_iso = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let mut stmt = conn.prepare(
        &format!(
            "SELECT {EVENT_COLS}{EVENT_REL_COLS} FROM Event{EVENT_JOINS} WHERE Event.user_id = ?1 AND Event.start_at >= ?2 AND Event.archived_at IS NULL AND Event.deleted_at IS NULL \
             ORDER BY Event.start_at ASC LIMIT ?3"
        ),
    )?;

    let events = stmt
        .query_map(rusqlite::params![user_id, &now_iso, &limit], row_to_event)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
}
