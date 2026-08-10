use chrono::{DateTime, Utc};
use rusqlite::Connection;

use crate::cadence::{
    threshold_for, CadenceConfig, CadenceEngine, CadenceError, ContactRow, Importance, Result as CadenceResult,
};
use crate::models::{Reminder, ReminderKind};

pub struct LocalEngine<'a>(pub &'a Connection);

impl<'a> LocalEngine<'a> {
    fn user_id_for(&self, contact_id: &str) -> CadenceResult<String> {
        self.0
            .query_row(
                "SELECT user_id FROM Contact WHERE id = ?1",
                [contact_id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|e| CadenceError::Db(e.to_string()))
    }

    fn nickname_for(&self, contact_id: &str) -> Option<String> {
        self.0
            .query_row(
                "SELECT nickname FROM Contact WHERE id = ?1",
                [contact_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
    }
}

impl<'a> CadenceEngine for LocalEngine<'a> {
    fn list_contacts_due(
        &self,
        now: DateTime<Utc>,
        cfg: &CadenceConfig,
    ) -> CadenceResult<Vec<ContactRow>> {
        let mut stmt = self
            .0
            .prepare(
                "SELECT id, name, importance, last_interaction_at FROM Contact",
            )
            .map_err(|e| CadenceError::Db(e.to_string()))?;
        let mapped = stmt
            .query_map([], |r| {
                Ok(ContactRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    importance: Importance::parse(&r.get::<_, String>(2)?)
                        .unwrap_or(Importance::Low),
                    last_interaction_at: r
                        .get::<_, Option<String>>(3)?
                        .and_then(|s| {
                            DateTime::parse_from_rfc3339(&s)
                                .ok()
                                .map(|d| d.with_timezone(&Utc))
                        }),
                })
            })
            .map_err(|e| CadenceError::Db(e.to_string()))?;

        let mut out = Vec::new();
        for row in mapped {
            let cr = row.map_err(|e| CadenceError::Db(e.to_string()))?;
            let Some(_thr) = threshold_for(cr.importance) else { continue };
            let due = match cr.last_interaction_at {
                None => true,
                Some(t) => {
                    let days = (now - t).num_days();
                    days > cfg.medium_days
                        || (matches!(cr.importance, Importance::High)
                            && days > cfg.high_days)
                }
            };
            if due {
                out.push(cr);
            }
        }
        Ok(out)
    }

    fn existing_cadence_reminder(&self, contact_id: &str) -> CadenceResult<Option<Reminder>> {
        let mut stmt = self
            .0
            .prepare(
                "SELECT id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at FROM reminder \
                 WHERE contact_id = ?1 AND kind = 'cadence' AND dismissed = 0 LIMIT 1",
            )
            .map_err(|e| CadenceError::Db(e.to_string()))?;
        let mut rows = stmt
            .query([contact_id])
            .map_err(|e| CadenceError::Db(e.to_string()))?;
        if let Ok(Some(row)) = rows.next() {
            let r = row;
            let kind_str: String = r.get(5)?;
            let kind = match kind_str.as_str() {
                "cadence" => ReminderKind::Cadence,
                _ => ReminderKind::Time,
            };
            Ok(Some(Reminder {
                id: r.get(0)?,
                user_id: r.get(1)?,
                contact_id: r.get(2)?,
                event_id: r.get(3)?,
                trigger_at: r.get(4)?,
                kind,
                dispatched: r.get(6)?,
                dismissed: r.get(7)?,
                invitation_token: r.get(8)?,
                created_at: r.get(9)?,
                contact_nickname: None,
            }))
        } else {
            Ok(None)
        }
    }

    fn create_cadence_reminder(
        &self,
        contact_id: &str,
        now: DateTime<Utc>,
        token: &str,
    ) -> CadenceResult<Reminder> {
        let user_id = self.user_id_for(contact_id)?;
        let nickname = self.nickname_for(contact_id);
        let id = uuid::Uuid::new_v4().to_string();
        let trigger_at = now.to_rfc3339();
        let created_at = now.to_rfc3339();
        self.0
            .execute(
                "INSERT INTO reminder (id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at) \
                 VALUES (?1, ?2, ?3, NULL, ?4, 'cadence', 0, 0, ?5, ?6)",
                rusqlite::params![
                    id,
                    user_id,
                    contact_id,
                    trigger_at,
                    token,
                    created_at,
                ],
            )
            .map_err(|e| CadenceError::Db(e.to_string()))?;
        Ok(Reminder {
            id,
            user_id,
            contact_id: Some(contact_id.to_string()),
            event_id: None,
            trigger_at,
            kind: ReminderKind::Cadence,
            dispatched: false,
            dismissed: false,
            invitation_token: Some(token.to_string()),
            created_at,
            contact_nickname: nickname,
        })
    }
}

pub fn tick_cadence(now: DateTime<Utc>, conn: &Connection) -> CadenceResult<()> {
    let engine = LocalEngine(conn);
    let cfg = CadenceConfig::default();
    for c in engine.list_contacts_due(now, &cfg)? {
        if engine.existing_cadence_reminder(&c.id)?.is_some() {
            continue;
        }
        let Some(thr) = threshold_for(c.importance) else { continue };
        let user_id = engine.user_id_for(&c.id)?;
        let token = make_invitation_token_local(&user_id, &c.id, thr);
        engine.create_cadence_reminder(&c.id, now, &token)?;
    }
    Ok(())
}

fn make_invitation_token_local(user_id: &str, contact_id: &str, threshold_day: i64) -> String {
    format!("{user_id}:{contact_id}:{threshold_day}")
}