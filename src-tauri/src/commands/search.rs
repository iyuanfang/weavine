use crate::db::Database;
use crate::models::*;
use tauri::State;

fn row_to_contact(row: &rusqlite::Row) -> rusqlite::Result<Contact> {
    Ok(Contact {
        id: row.get(0)?,
        owner_id: row.get(1)?,
        nickname: row.get(2)?,
        name: row.get(3)?,
        company: row.get(4)?,
        title: row.get(5)?,
        city: row.get(6)?,
        email: row.get(7)?,
        phone: row.get(8)?,
        wechat: row.get(9)?,
        notes: row.get(10)?,
        importance: row.get(11)?,
        reminder_enabled: row.get::<_, i64>(12)? != 0,
        reminder_interval_days: row.get(13)?,
        last_contacted_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        tags: Vec::new(),
    })
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

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
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

fn row_to_action(row: &rusqlite::Row) -> rusqlite::Result<Action> {
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
        event_id: row.get(9)?,
        completed_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[tauri::command]
pub fn search(
    db: State<Database>,
    owner_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<SearchResults, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20);
    let pattern = format!("%{}%", query);

    let contacts: Vec<Contact> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, ownerId, nickname, name, company, title, city, email, phone, wechat, notes, importance, reminderEnabled, reminderIntervalDays, lastContactedAt, createdAt, updatedAt \
                 FROM Contact WHERE ownerId = ?1 \
                 AND (nickname LIKE ?2 OR name LIKE ?2 OR company LIKE ?2 OR notes LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2) \
                 ORDER BY updatedAt DESC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&owner_id, &pattern, &limit], row_to_contact)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    let interactions: Vec<Interaction> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
                 FROM Interaction WHERE ownerId = ?1 AND summary LIKE ?2 \
                 ORDER BY occurredAt DESC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&owner_id, &pattern, &limit], row_to_interaction)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    let events: Vec<Event> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, createdAt, updatedAt \
                 FROM Event WHERE ownerId = ?1 \
                 AND (title LIKE ?2 OR location LIKE ?2 OR notes LIKE ?2) \
                 ORDER BY startAt ASC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&owner_id, &pattern, &limit], row_to_event)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    let actions: Vec<Action> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, eventId, completedAt, createdAt, updatedAt \
                 FROM Action WHERE ownerId = ?1 \
                 AND (title LIKE ?2 OR description LIKE ?2 OR category LIKE ?2) \
                 ORDER BY dueAt ASC LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&owner_id, &pattern, &limit], row_to_action)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    Ok(SearchResults {
        contacts,
        interactions,
        events,
        actions,
    })
}
