use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

const REMINDER_COLS: &str =
    "Reminder.id, Reminder.user_id, Reminder.contact_id, Reminder.event_id, Reminder.trigger_at, Reminder.kind, Reminder.dispatched, Reminder.dismissed, Reminder.invitation_token, Reminder.created_at, Reminder.deleted_at, c.nickname AS contact_nickname";

const REMINDER_JOIN: &str =
    " LEFT JOIN \"Contact\" c ON c.id = Reminder.contact_id AND c.user_id = Reminder.user_id";

pub(crate) fn row_to_reminder(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    let kind_str: String = row.get(5)?;
    let kind: ReminderKind = kind_str.parse().map_err(|e: String| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            e,
        )))
    })?;
    Ok(Reminder {
        id: row.get(0)?,
        user_id: row.get(1)?,
        contact_id: row.get(2)?,
        event_id: row.get(3)?,
        trigger_at: row.get(4)?,
        kind,
        dispatched: row.get::<_, i64>(6)? != 0,
        dismissed: row.get::<_, i64>(7)? != 0,
        invitation_token: row.get(8)?,
        created_at: row.get(9)?,
        deleted_at: row.get(10).ok(),
        contact_nickname: row.get(11)?,
    })
}

pub fn list(
    conn: &Connection,
    user_id: &str,
    contact_id: Option<&str>,
    event_id: Option<&str>,
    include_dismissed: Option<bool>,
    limit: Option<i64>,
) -> rusqlite::Result<Vec<Reminder>> {
    let limit = limit.unwrap_or(100);
    let include_dismissed = include_dismissed.unwrap_or(false);

    let mut sql = format!(
        "SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} WHERE Reminder.user_id = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(user_id.to_string())];
    let mut idx = 2;

    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND contact_id = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(eid) = event_id {
        sql.push_str(&format!(" AND event_id = ?{}", idx));
        param_values.push(Box::new(eid.to_string()));
        idx += 1;
    }
    if !include_dismissed {
        sql.push_str(" AND dismissed = 0");
    }
    sql.push_str(" AND Reminder.deleted_at IS NULL");

    sql.push_str(&format!(" ORDER BY trigger_at ASC LIMIT ?{}", idx));
    param_values.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|b| b.as_ref()).collect();

    let reminders = stmt
        .query_map(params_refs.as_slice(), row_to_reminder)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(reminders)
}

pub fn create(conn: &Connection, input: &CreateReminderInput) -> rusqlite::Result<Reminder> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let kind_str = input.kind.unwrap_or_default().to_string();

    conn.execute(
        "INSERT INTO Reminder \
         (id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?8)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.contact_id,
            &input.event_id,
            &input.trigger_at,
            &kind_str,
            &input.invitation_token,
            &now,
        ],
    )?;

    conn.query_row(
        &format!("SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} WHERE Reminder.id = ?1"),
        rusqlite::params![&id],
        row_to_reminder,
    )
}

pub fn update(conn: &Connection, input: &UpdateReminderInput) -> rusqlite::Result<Reminder> {
    let mut sql = String::from("UPDATE Reminder SET ");
    let mut set_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref t) = input.trigger_at {
        set_clauses.push(format!("trigger_at = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref k) = input.kind {
        set_clauses.push(format!("kind = ?{}", param_idx));
        params.push(Box::new(k.to_string()));
        param_idx += 1;
    }
    if let Some(disp) = input.dispatched {
        set_clauses.push(format!("dispatched = ?{}", param_idx));
        params.push(Box::new(if disp { 1i64 } else { 0i64 }));
        param_idx += 1;
    }
    if let Some(dis) = input.dismissed {
        set_clauses.push(format!("dismissed = ?{}", param_idx));
        params.push(Box::new(if dis { 1i64 } else { 0i64 }));
        param_idx += 1;
    }

    sql.push_str(&set_clauses.join(", "));
    sql.push_str(&format!(" WHERE id = ?{}", param_idx));
    params.push(Box::new(input.id.clone()));

    {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|b| b.as_ref()).collect();
        conn.execute(&sql, params_refs.as_slice())?;
    }

    conn.query_row(
        &format!("SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} WHERE Reminder.id = ?1"),
        rusqlite::params![&input.id],
        row_to_reminder,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    conn.execute(
        "UPDATE Reminder SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        rusqlite::params![&now, id],
    )?;
    Ok(())
}

pub fn dismiss(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE Reminder SET dismissed = 1 WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

pub fn claim_due_reminders(conn: &Connection) -> rusqlite::Result<Vec<Reminder>> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let mut stmt = conn.prepare(
        &format!(
            "SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} \
             WHERE Reminder.dismissed = 0 AND Reminder.dispatched = 0 AND Reminder.deleted_at IS NULL AND Reminder.trigger_at <= ?1",
        ),
    )?;
    let reminders: Vec<Reminder> = stmt
        .query_map([&now], row_to_reminder)?
        .filter_map(|r| r.ok())
        .collect();
    for r in &reminders {
        conn.execute(
            "UPDATE Reminder SET dispatched = 1 WHERE id = ?1",
            rusqlite::params![r.id],
        )?;
    }
    Ok(reminders)
}

impl Reminder {
    pub fn summary(&self) -> String {
        match self.kind {
            ReminderKind::Time => "定时提醒".to_string(),
            ReminderKind::Cadence => "周期提醒".to_string(),
        }
    }
}

pub fn sync_event_reminder(conn: &Connection, event: &crate::models::Event) -> rusqlite::Result<Option<Reminder>> {
    conn.execute(
        "DELETE FROM Reminder WHERE event_id = ?1 AND kind = 'time'",
        rusqlite::params![event.id],
    )?;
    let lead = match event.reminder_lead_minutes {
        Some(l) if l > 0 => l,
        _ => return Ok(None),
    };
    let start = chrono::DateTime::parse_from_rfc3339(&event.start_at)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let trigger = start - chrono::Duration::minutes(lead);
    let trigger_str = trigger.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let id = format!("auto-rem-{}", event.id);
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    conn.execute(
        "INSERT INTO Reminder (id, user_id, event_id, trigger_at, kind, dispatched, dismissed, created_at) \
         VALUES (?1, ?2, ?3, ?4, 'time', 0, 0, ?5)",
        rusqlite::params![&id, &event.user_id, &event.id, &trigger_str, &now],
    )?;
    let reminder = conn.query_row(
        &format!("SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} WHERE Reminder.id = ?1"),
        rusqlite::params![&id],
        row_to_reminder,
    )?;
    Ok(Some(reminder))
}

/// All dismissed=0, dispatched=0 reminders, ordered by trigger_at.
pub fn list_pending(conn: &Connection) -> rusqlite::Result<Vec<Reminder>> {
    let mut stmt = conn.prepare(
        &format!(
            "SELECT {REMINDER_COLS} FROM Reminder{REMINDER_JOIN} \
             WHERE Reminder.dismissed = 0 AND Reminder.dispatched = 0 AND Reminder.deleted_at IS NULL \
             ORDER BY Reminder.trigger_at ASC"
        ),
    )?;
    let reminders = stmt
        .query_map([], row_to_reminder)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(reminders)
}
