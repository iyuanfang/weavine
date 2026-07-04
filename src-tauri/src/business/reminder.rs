use crate::models::*;
use rusqlite::Connection;
use uuid::Uuid;

pub(crate) fn row_to_reminder(row: &rusqlite::Row) -> rusqlite::Result<Reminder> {
    Ok(Reminder {
        id: row.get(0)?,
        user_id: row.get(1)?,
        contact_id: row.get(2)?,
        event_id: row.get(3)?,
        trigger_at: row.get(4)?,
        kind: row.get(5)?,
        dispatched: row.get::<_, i64>(6)? != 0,
        dismissed: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
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

    let mut sql = String::from(
        "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
         FROM Reminder WHERE ownerId = ?1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(user_id.to_string())];
    let mut idx = 2;

    if let Some(cid) = contact_id {
        sql.push_str(&format!(" AND contactId = ?{}", idx));
        param_values.push(Box::new(cid.to_string()));
        idx += 1;
    }
    if let Some(eid) = event_id {
        sql.push_str(&format!(" AND eventId = ?{}", idx));
        param_values.push(Box::new(eid.to_string()));
        idx += 1;
    }
    if !include_dismissed {
        sql.push_str(" AND dismissed = 0");
    }

    sql.push_str(&format!(" ORDER BY triggerAt ASC LIMIT ?{}", idx));
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
    let kind = input.kind.clone().unwrap_or_else(|| "event".to_string());

    conn.execute(
        "INSERT INTO Reminder \
         (id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7)",
        rusqlite::params![
            &id,
            &input.user_id,
            &input.contact_id,
            &input.event_id,
            &input.trigger_at,
            &kind,
            &now,
        ],
    )?;

    conn.query_row(
        "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
         FROM Reminder WHERE id = ?1",
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
        set_clauses.push(format!("triggerAt = ?{}", param_idx));
        params.push(Box::new(t.clone()));
        param_idx += 1;
    }
    if let Some(ref k) = input.kind {
        set_clauses.push(format!("kind = ?{}", param_idx));
        params.push(Box::new(k.clone()));
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
        "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
         FROM Reminder WHERE id = ?1",
        rusqlite::params![&input.id],
        row_to_reminder,
    )
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM Reminder WHERE id = ?1", rusqlite::params![id])?;
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
        "SELECT id, ownerId, contactId, eventId, triggerAt, kind, dispatched, dismissed, createdAt \
         FROM Reminder WHERE dismissed = 0 AND dispatched = 0 AND triggerAt <= ?1",
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
        match self.kind.as_str() {
            "event" => "日程提醒".to_string(),
            "action" => "待办提醒".to_string(),
            "contact" => "联系人提醒".to_string(),
            _ => "提醒".to_string(),
        }
    }
}

pub fn sync_event_reminder(conn: &Connection, event: &crate::models::Event) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM Reminder WHERE eventId = ?1 AND kind = 'event'",
        rusqlite::params![event.id],
    )?;
    if let Some(lead) = event.reminder_lead_minutes {
        if lead <= 0 { return Ok(()); }
        let start = chrono::DateTime::parse_from_rfc3339(&event.start_at)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let trigger = start - chrono::Duration::minutes(lead);
        let trigger_str = trigger.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let id = format!("auto-rem-{}", event.id);
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        conn.execute(
            "INSERT INTO Reminder (id, ownerId, eventId, triggerAt, kind, dispatched, dismissed, createdAt) \
             VALUES (?1, ?2, ?3, ?4, 'event', 0, 0, ?5)",
            rusqlite::params![id, event.user_id, event.id, trigger_str, now],
        )?;
    }
    Ok(())
}
