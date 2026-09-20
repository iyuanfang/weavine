use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

const ACTION_COLS: &str =
    "Action.id, Action.user_id, Action.title, Action.status, Action.priority, Action.category, Action.due_at, Action.contact_id, Action.project_id, Action.completed_at, Action.archived_at, Action.created_at, Action.updated_at, Action.deleted_at";

const ACTION_REL_COLS: &str = ", c.nickname AS contact_nickname, p.title AS project_title";

const ACTION_JOINS: &str = " LEFT JOIN \"Contact\" c ON c.id = Action.contact_id AND c.user_id = Action.user_id \
                             LEFT JOIN \"Project\" p ON p.id = Action.project_id AND p.user_id = Action.user_id";

pub(crate) fn row_to_action(row: &rusqlite::Row) -> rusqlite::Result<Action> {
    Ok(Action {
        id: row.get(0)?,
        user_id: row.get(1)?,
        title: row.get(2)?,
        status: row.get(3)?,
        priority: row.get(4)?,
        category: row.get(5)?,
        due_at: row.get(6)?,
        contact_id: row.get(7)?,
        project_id: row.get(8)?,
        completed_at: row.get(9)?,
        archived_at: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        deleted_at: row.get(13).ok(),
        contact_nickname: row.get(14)?,
        project_title: row.get(15)?,
    })
}

pub fn list(
    conn: &Connection,
    user_id: &str,
    status: Option<&str>,
    contact_id: Option<&str>,
    project_id: Option<&str>,
    archived: Option<&str>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Action>> {
    let limit = limit.unwrap_or(100);

    let mut sql = format!(
        "SELECT {ACTION_COLS}{ACTION_REL_COLS} FROM Action{ACTION_JOINS} WHERE Action.user_id = ?1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(user_id.to_string())];
    let mut idx = 2;

    if let Some(s) = status {
        sql.push_str(&format!(" AND Action.status = ?{}", idx));
        param_values.push(Box::new(s.to_string()));
        idx += 1;
    }
    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND Action.contact_id = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(pid) = project_id {
        sql.push_str(&format!(" AND Action.project_id = ?{}", idx));
        param_values.push(Box::new(pid.to_string()));
        idx += 1;
    }
    match archived {
        Some(v) if v == "true" || v == "1" => {
            sql.push_str(" AND Action.archived_at IS NOT NULL");
        }
        Some("all") => {}
        _ => {
            sql.push_str(" AND Action.archived_at IS NULL");
        }
    }
    sql.push_str(" AND Action.deleted_at IS NULL");

    sql.push_str(&format!(" ORDER BY Action.due_at ASC, Action.priority DESC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let actions = stmt
        .query_map(params_refs.as_slice(), row_to_action)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(actions)
}

pub fn create(conn: &Connection, input: &CreateActionInput) -> rusqlite::Result<Action> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let status = input.status.clone().unwrap_or_else(|| "inbox".to_string());
    let priority = input.priority.unwrap_or(0);

    conn.execute(
        "INSERT INTO Action \
         (id, user_id, title, status, priority, category, due_at, contact_id, project_id, completed_at, archived_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.title,
            &status,
            &priority,
            &input.category,
            &input.due_at,
            &input.contact_id,
            input.project_id.as_deref(),
            None::<String>,
            None::<String>,
            &now,
            &now,
        ],
    )?;

    conn.query_row(
        &format!("SELECT {ACTION_COLS}{ACTION_REL_COLS} FROM Action{ACTION_JOINS} WHERE Action.id = ?1"),
        rusqlite::params![&id],
        row_to_action,
    )
}

pub fn update(conn: &Connection, input: &UpdateActionInput) -> rusqlite::Result<Action> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    let prev: Option<(Option<String>, Option<String>, String)> = conn
        .query_row(
            "SELECT contact_id, archived_at, user_id FROM Action WHERE id = ?1",
            rusqlite::params![&input.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();
    let (prev_contact_id, prev_archived_at, action_user_id) = match prev {
        Some(r) => r,
        None => return Err(rusqlite::Error::QueryReturnedNoRows),
    };

    let mut sql = String::from("UPDATE Action SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.title {
        set_clauses.push(format!("title = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref s) = input.status {
        set_clauses.push(format!("status = ?{}", param_idx));
        params.push(Box::new(s.clone()));
        param_idx += 1;
    }
    if let Some(ref p) = input.priority {
        set_clauses.push(format!("priority = ?{}", param_idx));
        params.push(Box::new(*p));
        param_idx += 1;
    }
    if let Some(ref c) = input.category {
        set_clauses.push(format!("category = ?{}", param_idx));
        params.push(Box::new(c.clone()));
        param_idx += 1;
    }
    if let Some(ref da) = input.due_at {
        set_clauses.push(format!("due_at = ?{}", param_idx));
        params.push(Box::new(da.clone()));
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
    if let Some(ref ca) = input.completed_at {
        set_clauses.push(format!("completed_at = ?{}", param_idx));
        params.push(Box::new(ca.clone()));
        param_idx += 1;
    }
    if let Some(ref aa) = input.archived_at {
        set_clauses.push(format!("archived_at = ?{}", param_idx));
        params.push(Box::new(aa.clone()));
        param_idx += 1;
    }

    set_clauses.push(format!("updated_at = ?{}", param_idx));
    params.push(Box::new(now.clone()));
    param_idx += 1;

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    // Archive hook: synthesize an Interaction when archived_at transitions
    // None → Some. occurred_at = action.completed_at when set, else the
    // archived_at timestamp. NoteEntity rows pointing at the action are
    // duplicated to point at the new interaction as well — the bidirectional
    // note↔action and note↔interaction traversals remain intact.
    let new_archived_at = input.archived_at.as_deref().filter(|s| !s.is_empty());
    let was_unarchived = prev_archived_at.is_none() || prev_archived_at.as_deref() == Some("");
    if was_unarchived && new_archived_at.is_some() {
        let action = conn.query_row(
            &format!("SELECT {ACTION_COLS}{ACTION_REL_COLS} FROM Action{ACTION_JOINS} WHERE Action.id = ?1"),
            rusqlite::params![&input.id],
            row_to_action,
        )?;
        let new_contact_id = input.contact_id.as_deref()
            .map(|s| s.to_string())
            .or_else(|| prev_contact_id.clone())
            .filter(|s| !s.is_empty());
        let occurred_at = action
            .completed_at
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| new_archived_at.map(|s| s.to_string()))
            .unwrap_or_else(|| now.clone());
        let iid = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO Interaction \
             (id, user_id, contact_id, action_id, event_id, occurred_at, channel, summary, source, source_ref, created_at) \
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, ?6, 'archive', ?4, ?7)",
            rusqlite::params![
                &iid,
                &action_user_id,
                new_contact_id.as_deref(),
                &input.id,
                &occurred_at,
                &action.title,
                &now,
            ],
        )?;
        // UNIQUE(note_id, entity_type, entity_id) on NoteEntity makes this
        // idempotent: re-archiving the same action is a no-op.
        conn.execute(
            "INSERT OR IGNORE INTO NoteEntity (id, note_id, user_id, entity_type, entity_id, created_at) \
             SELECT lower(hex(randomblob(16))), ne.note_id, ne.user_id, 'interaction', ?1, ?2 \
             FROM NoteEntity ne \
             WHERE ne.user_id = ?3 AND ne.entity_type = 'action' AND ne.entity_id = ?4",
            rusqlite::params![&iid, &now, &action_user_id, &input.id],
        )?;
    }

    conn.query_row(
        &format!("SELECT {ACTION_COLS}{ACTION_REL_COLS} FROM Action{ACTION_JOINS} WHERE Action.id = ?1"),
        rusqlite::params![&input.id],
        row_to_action,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    conn.execute(
        "UPDATE Action SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        rusqlite::params![&now, id],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Action> {
    conn.query_row(
        &format!("SELECT {ACTION_COLS}{ACTION_REL_COLS} FROM Action{ACTION_JOINS} WHERE Action.id = ?1 AND Action.deleted_at IS NULL"),
        rusqlite::params![id],
        row_to_action,
    )
}
