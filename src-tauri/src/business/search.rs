use crate::business::action::row_to_action;
use crate::business::contact::row_to_contact;
use crate::business::event::row_to_event;
use crate::business::interaction::row_to_interaction;
use crate::business::note::row_to_note;
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
            "SELECT id, user_id, nickname, name, company, title, address, email, phone, wechat, importance, last_interaction_at, keep_in_touch_cadence_days, created_at, updated_at \
             FROM Contact WHERE user_id = ?1 \
             AND (nickname LIKE ?2 OR name LIKE ?2 OR company LIKE ?2 OR email LIKE ?2 OR phone LIKE ?2) \
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
            "SELECT Interaction.id, Interaction.user_id, Interaction.contact_id, Interaction.action_id, Interaction.event_id, Interaction.occurred_at, Interaction.channel, Interaction.summary, Interaction.source, Interaction.source_ref, Interaction.created_at, c.nickname AS contact_nickname \
             FROM Interaction LEFT JOIN \"Contact\" c ON c.id = Interaction.contact_id AND c.user_id = Interaction.user_id \
             WHERE Interaction.user_id = ?1 AND Interaction.summary LIKE ?2 \
             ORDER BY Interaction.occurred_at DESC LIMIT ?3",
        )?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_interaction)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Interaction>>();
        results
    };

    let events: Vec<Event> = {
        let sql = format!(
            "SELECT Event.id, Event.user_id, Event.title, Event.event_type, Event.start_at, Event.end_at, Event.location, Event.contact_id, Event.project_id, Event.reminder_lead_minutes, Event.archived_at, Event.created_at, Event.updated_at, c.nickname AS contact_nickname, p.title AS project_title \
             FROM Event LEFT JOIN \"Contact\" c ON c.id = Event.contact_id AND c.user_id = Event.user_id \
             LEFT JOIN \"Project\" p ON p.id = Event.project_id AND p.user_id = Event.user_id \
             WHERE Event.user_id = ?1 \
             AND (Event.title LIKE ?2 OR Event.location LIKE ?2){} \
             ORDER BY Event.start_at ASC LIMIT ?3",
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
            "SELECT Action.id, Action.user_id, Action.title, Action.status, Action.priority, Action.category, Action.due_at, Action.contact_id, Action.project_id, Action.completed_at, Action.archived_at, Action.created_at, Action.updated_at, c.nickname AS contact_nickname, p.title AS project_title \
             FROM Action LEFT JOIN \"Contact\" c ON c.id = Action.contact_id AND c.user_id = Action.user_id \
             LEFT JOIN \"Project\" p ON p.id = Action.project_id AND p.user_id = Action.user_id \
             WHERE Action.user_id = ?1 \
             AND (Action.title LIKE ?2 OR Action.category LIKE ?2){} \
             ORDER BY Action.due_at ASC LIMIT ?3",
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
            "SELECT id, user_id, title, template, stage, start_at, due_at, completed_at, archived_at, created_at, updated_at \
             FROM \"Project\" WHERE user_id = ?1 \
             AND (title LIKE ?2){} \
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

    let notes: Vec<Note> = {
        let sql = format!(
            "SELECT id, user_id, title, substr(body, 1, 200), archived_at, created_at, updated_at \
             FROM Note WHERE user_id = ?1 \
             AND (title LIKE ?2 OR body LIKE ?2){} \
             ORDER BY updated_at DESC LIMIT ?3",
            archive_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let results = stmt
            .query_map(rusqlite::params![user_id, &pattern, &limit], row_to_note)?
            .filter_map(|r| r.ok())
            .collect::<Vec<Note>>();
        results
    };

    Ok(SearchResults {
        contacts,
        interactions,
        events,
        actions,
        projects,
        notes,
    })
}
