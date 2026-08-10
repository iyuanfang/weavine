use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::Reminder;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Importance {
    Low,
    Medium,
    High,
}

impl Importance {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "low" => Some(Self::Low),
            "medium" => Some(Self::Medium),
            "high" => Some(Self::High),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CadenceConfig {
    pub high_days: i64,
    pub medium_days: i64,
}

impl Default for CadenceConfig {
    fn default() -> Self {
        Self { high_days: 14, medium_days: 45 }
    }
}

pub fn threshold_for(imp: Importance) -> Option<i64> {
    let cfg = CadenceConfig::default();
    match imp {
        Importance::High => Some(cfg.high_days),
        Importance::Medium => Some(cfg.medium_days),
        Importance::Low => None,
    }
}

pub fn make_invitation_token(user_id: &str, contact_id: &str, threshold_day: i64) -> String {
    format!("{user_id}:{contact_id}:{threshold_day}")
}

#[derive(Debug, Clone)]
pub struct ContactRow {
    pub id: String,
    pub name: String,
    pub importance: Importance,
    pub last_interaction_at: Option<DateTime<Utc>>,
}

#[derive(Debug, thiserror::Error)]
pub enum CadenceError {
    #[error("db: {0}")]
    Db(String),
}

impl From<rusqlite::Error> for CadenceError {
    fn from(e: rusqlite::Error) -> Self {
        CadenceError::Db(e.to_string())
    }
}

#[cfg(feature = "sqlx")]
impl From<sqlx::Error> for CadenceError {
    fn from(e: sqlx::Error) -> Self {
        CadenceError::Db(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CadenceError>;

pub trait CadenceEngine {
    fn list_contacts_due(
        &self,
        now: DateTime<Utc>,
        cfg: &CadenceConfig,
    ) -> Result<Vec<ContactRow>>;
    fn existing_cadence_reminder(&self, contact_id: &str) -> Result<Option<Reminder>>;
    fn create_cadence_reminder(
        &self,
        contact_id: &str,
        now: DateTime<Utc>,
        token: &str,
    ) -> Result<Reminder>;
}