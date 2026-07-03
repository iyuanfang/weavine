use crate::business::action::row_to_action;
use crate::business::contact::row_to_contact;
use crate::business::event::row_to_event;
use crate::business::interaction::row_to_interaction;
use crate::models::*;
use rusqlite::Connection;

pub fn search(
    conn: &Connection,
    owner_id: &str,
    query: &str,
    limit: Option<i64>,
) -> rusqlite::Result<SearchResults> {
    let limit = limit.unwrap_or(20);
    let pattern = format!("%{}%", query);

    let contacts: Vec<Contact> = {
        let mut stmt = conn.prepare(
            "SELECT id, ownerId, nickname, name, company, title, city, email, phone, wechat, notes, importance, reminderEnabled, reminderIntervalDays, lastContactedAt, createdAt, updatedAt \
             FROM Contact WHERE ownerId = ?1 \
             AND (nickname LIKE ?2 OR name LIKE ?2 OR company LIKE ?2 OR notes LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2) \
             ORDER BY updatedAt DESC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![owner_id, &pattern, &limit], row_to_contact)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Contact>>();
        results
    };

    let interactions: Vec<Interaction> = {
        let mut stmt = conn.prepare(
            "SELECT id, ownerId, contactId, actionId, eventId, occurredAt, channel, summary, createdAt \
             FROM Interaction WHERE ownerId = ?1 AND summary LIKE ?2 \
             ORDER BY occurredAt DESC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![owner_id, &pattern, &limit], row_to_interaction)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Interaction>>();
        results
    };

    let events: Vec<Event> = {
        let mut stmt = conn.prepare(
            "SELECT id, ownerId, title, type, startAt, endAt, location, notes, contactId, reminderLeadMinutes, createdAt, updatedAt \
             FROM Event WHERE ownerId = ?1 \
             AND (title LIKE ?2 OR location LIKE ?2 OR notes LIKE ?2) \
             ORDER BY startAt ASC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![owner_id, &pattern, &limit], row_to_event)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Event>>();
        results
    };

    let actions: Vec<Action> = {
        let mut stmt = conn.prepare(
            "SELECT id, ownerId, title, description, status, priority, category, dueAt, contactId, completedAt, createdAt, updatedAt \
             FROM Action WHERE ownerId = ?1 \
             AND (title LIKE ?2 OR description LIKE ?2 OR category LIKE ?2) \
             ORDER BY dueAt ASC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![owner_id, &pattern, &limit], row_to_action)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Action>>();
        results
    };

    Ok(SearchResults {
        contacts,
        interactions,
        events,
        actions,
    })
}
