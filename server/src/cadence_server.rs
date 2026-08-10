use std::sync::Arc;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use weavine_lib::cadence::{
    threshold_for, CadenceConfig, ContactRow, Importance, Result,
};
use weavine_lib::models::{Reminder, ReminderKind};

pub struct PgEngine<'a>(pub &'a PgPool);

impl<'a> PgEngine<'a> {
    pub async fn user_id_for(&self, contact_id: &str) -> Result<String> {
        let row: (String,) = sqlx::query_as("SELECT user_id FROM contact WHERE id = $1")
            .bind(contact_id)
            .fetch_one(self.0)
            .await?;
        Ok(row.0)
    }

    pub async fn nickname_for(&self, contact_id: &str) -> Result<Option<String>> {
        let row: (Option<String>,) =
            sqlx::query_as("SELECT nickname FROM contact WHERE id = $1")
                .bind(contact_id)
                .fetch_one(self.0)
                .await?;
        Ok(row.0)
    }

    pub async fn list_contacts_due(
        &self,
        now: DateTime<Utc>,
        cfg: &CadenceConfig,
    ) -> Result<Vec<ContactRow>> {
        let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, name, importance, last_interaction_at FROM contact",
        )
        .fetch_all(self.0)
        .await?;

        let mut out = Vec::new();
        for (id, name, importance_s, last_interaction_at_s) in rows {
            let importance = Importance::parse(&importance_s).unwrap_or(Importance::Low);
            let Some(_thr) = threshold_for(importance) else { continue };
            let last_interaction_at = last_interaction_at_s.as_deref().and_then(|s| {
                DateTime::parse_from_rfc3339(s)
                    .ok()
                    .map(|d| d.with_timezone(&Utc))
            });
            let due = match last_interaction_at {
                None => true,
                Some(t) => {
                    let days = (now - t).num_days();
                    days > cfg.medium_days
                        || (matches!(importance, Importance::High) && days > cfg.high_days)
                }
            };
            if due {
                out.push(ContactRow {
                    id,
                    name,
                    importance,
                    last_interaction_at,
                });
            }
        }
        Ok(out)
    }

    pub async fn existing_cadence_reminder(
        &self,
        contact_id: &str,
    ) -> Result<Option<Reminder>> {
        let row: Option<(
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            bool,
            bool,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at \
             FROM reminder WHERE contact_id = $1 AND kind = 'cadence' AND dismissed = false LIMIT 1",
        )
        .bind(contact_id)
        .fetch_optional(self.0)
        .await?;

        if let Some((
            id,
            user_id,
            contact_id,
            event_id,
            trigger_at,
            kind_s,
            dispatched,
            dismissed,
            invitation_token,
            created_at,
        )) = row
        {
            let kind = match kind_s.as_str() {
                "cadence" => ReminderKind::Cadence,
                _ => ReminderKind::Time,
            };
            Ok(Some(Reminder {
                id,
                user_id,
                contact_id,
                event_id,
                trigger_at,
                kind,
                dispatched,
                dismissed,
                invitation_token,
                created_at,
                contact_nickname: None,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn create_cadence_reminder(
        &self,
        contact_id: &str,
        now: DateTime<Utc>,
        token: &str,
    ) -> Result<Reminder> {
        let user_id = self.user_id_for(contact_id).await?;
        let nickname = self.nickname_for(contact_id).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let trigger_at = now.to_rfc3339();
        let created_at = now.to_rfc3339();
        sqlx::query(
            "INSERT INTO reminder (id, user_id, contact_id, event_id, trigger_at, kind, dispatched, dismissed, invitation_token, created_at) \
             VALUES ($1, $2, $3, NULL, $4, 'cadence', false, false, $5, $6)",
        )
        .bind(&id)
        .bind(&user_id)
        .bind(contact_id)
        .bind(&trigger_at)
        .bind(&token)
        .bind(&created_at)
        .execute(self.0)
        .await?;
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

pub async fn tick_cadence_async(now: DateTime<Utc>, pool: &PgPool) -> Result<()> {
    let engine = PgEngine(pool);
    let cfg = CadenceConfig::default();
    for c in engine.list_contacts_due(now, &cfg).await? {
        if engine.existing_cadence_reminder(&c.id).await?.is_some() {
            continue;
        }
        let Some(thr) = threshold_for(c.importance) else { continue };
        let user_id = engine.user_id_for(&c.id).await?;
        let token = format!("{user_id}:{}:{thr}", c.id);
        engine.create_cadence_reminder(&c.id, now, &token).await?;
    }
    Ok(())
}

const CADENCE_TICK_INTERVAL_SECS: u64 = 3600;

pub fn spawn_cadence_scheduler(pool: Arc<PgPool>) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(
            CADENCE_TICK_INTERVAL_SECS,
        ));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            match tick_cadence_async(chrono::Utc::now(), &pool).await {
                Ok(()) => {}
                Err(e) => eprintln!("[cadence-tick] error: {e}"),
            }
        }
    });
}