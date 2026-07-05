use crate::business::action::row_to_action;
use crate::business::contact::row_to_contact;
use crate::business::event::row_to_event;
use crate::business::interaction::row_to_interaction;
use crate::business::project::row_to_project;
use crate::models::*;
use rusqlite::Connection;

pub fn search(
    conn: &Connection,
    user_id: &str,
    query: &str,
    limit: Option<i64>,
    include_archived: bool,
) -> rusqlite::Result<SearchResults> {
    let limit = limit.unwrap_or(20);
    let pattern = format!("%{}%", query);
    let archive_clause = if include_archived { "" } else { " AND archived_at IS NULL" };

    let contacts: Vec<Contact> = {
        let mut stmt = conn.prepare(
            "SELECT id, user_id, nickname, name, company, title, city, email, phone, wechat, notes, importance, reminder_enabled, reminder_interval_days, last_contacted_at, created_at, updated_at \
             FROM Contact WHERE user_id = ?1 \
             AND (nickname LIKE ?2 OR name LIKE ?2 OR company LIKE ?2 OR notes LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2) \
             ORDER BY updated_at DESC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_contact)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Contact>>();
        results
    };

    let interactions: Vec<Interaction> = {
        let mut stmt = conn.prepare(
            "SELECT id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
             FROM Interaction WHERE user_id = ?1 AND summary LIKE ?2 \
             ORDER BY occurred_at DESC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_interaction)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Interaction>>();
        results
    };

    let events: Vec<Event> = {
        let sql = format!(
            "SELECT id, user_id, title, event_type, start_at, end_at, location, notes, contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
             FROM Event WHERE user_id = ?1 \
             AND (title LIKE ?2 OR location LIKE ?2 OR notes LIKE ?2){} \
             ORDER BY start_at ASC LIMIT ?3",
            archive_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_event)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Event>>();
        results
    };

    let actions: Vec<Action> = {
        let sql = format!(
            "SELECT id, user_id, title, description, status, priority, category, due_at, contact_id, project_id, completed_at, archived_at, created_at, updated_at \
             FROM Action WHERE user_id = ?1 \
             AND (title LIKE ?2 OR description LIKE ?2 OR category LIKE ?2){} \
             ORDER BY due_at ASC LIMIT ?3",
            archive_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_action)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Action>>();
        results
    };

    let projects: Vec<Project> = {
        let sql = format!(
            "SELECT id, user_id, title, description, template, stage, start_at, due_at, completed_at, archived_at, created_at, updated_at \
             FROM \"Project\" WHERE user_id = ?1 \
             AND (title LIKE ?2 OR description LIKE ?2){} \
             ORDER BY updated_at DESC LIMIT ?3",
            archive_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_project)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Project>>();
        results
    };

    Ok(SearchResults {
        contacts,
        interactions,
        events,
        actions,
        projects,
    })
}
