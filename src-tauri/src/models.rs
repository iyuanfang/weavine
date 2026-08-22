use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────
// Domain models
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub email_verified: Option<String>,
    pub image: Option<String>,
    pub password_hash: Option<String>,
    pub is_local: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalUser {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Contact {
    pub id: String,
    pub user_id: String,
    pub nickname: String,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: String,
    pub last_interaction_at: String,
    pub keep_in_touch_cadence_days: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    #[cfg_attr(feature = "sqlx", sqlx(skip))]
    pub tags: Vec<Tag>,
    pub avatar_storage_key: Option<String>,
    pub avatar_mime: Option<String>,
    pub avatar_width: Option<i64>,
    pub avatar_height: Option<i64>,
    pub avatar_alt_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Tag {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Event {
    pub id: String,
    pub user_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub reminder_lead_minutes: Option<i64>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub contact_nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub project_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Interaction {
    pub id: String,
    pub user_id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: String,
    pub channel: Option<String>,
    pub summary: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub contact_nickname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Project {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub template: String,
    pub stage: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Action {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i64,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub contact_nickname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub project_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContact {
    pub user_id: String,
    pub project_id: String,
    pub contact_id: String,
    pub role: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct EntityLink {
    pub id: String,
    pub user_id: String,
    pub from_type: String,
    pub from_id: String,
    pub to_type: String,
    pub to_id: String,
    pub relation_type: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Media {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub owner_type: String,
    pub owner_id: String,
    pub mime: String,
    pub size_bytes: i64,
    pub storage_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContactWithContact {
    pub contact: Contact,
    pub role: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderKind {
    Time,
    Cadence,
}

impl Default for ReminderKind {
    fn default() -> Self {
        Self::Time
    }
}

impl std::fmt::Display for ReminderKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Time => write!(f, "time"),
            Self::Cadence => write!(f, "cadence"),
        }
    }
}

impl std::str::FromStr for ReminderKind {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "time" => Ok(Self::Time),
            "cadence" => Ok(Self::Cadence),
            _ => Err(format!("invalid ReminderKind: {s}")),
        }
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Type<sqlx::Postgres> for ReminderKind {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <&str as sqlx::Type<sqlx::Postgres>>::type_info()
    }
    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <&str as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Encode<'_, sqlx::Postgres> for ReminderKind {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        let s = self.to_string();
        <&str as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&s.as_str(), buf)
    }
}

#[cfg(feature = "sqlx")]
impl sqlx::Decode<'_, sqlx::Postgres> for ReminderKind {
    fn decode(value: sqlx::postgres::PgValueRef<'_>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        s.parse().map_err(|e: String| -> sqlx::error::BoxDynError { e.into() })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Reminder {
    pub id: String,
    pub user_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub trigger_at: String,
    pub kind: ReminderKind,
    pub dispatched: bool,
    pub dismissed: bool,
    pub invitation_token: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub contact_nickname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Setting {
    pub id: String,
    pub user_id: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

// ──────────────────────────────────────────────
// Query DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListContactsParams {
    pub user_id: String,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub importance: Option<String>,
    #[serde(default = "default_contact_sort")]
    pub sort_by: String,
    #[serde(default = "default_contact_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

pub const CONTACT_SORT_WHITELIST: &[(&str, &str)] = &[
    ("last_interaction_at", "last_interaction_at DESC NULLS LAST, created_at DESC, id ASC"),
    ("created_at",         "created_at DESC, id ASC"),
    ("nickname",           "nickname COLLATE NOCASE ASC, id ASC"),
];

pub const DEFAULT_CONTACT_SORT: &str = "last_interaction_at";
pub const DEFAULT_CONTACT_LIMIT: i64 = 20;
pub const MAX_CONTACT_LIMIT: i64 = 200;

fn default_contact_sort() -> String {
    DEFAULT_CONTACT_SORT.to_string()
}

fn default_contact_limit() -> i64 {
    DEFAULT_CONTACT_LIMIT
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContactInput {
    pub user_id: String,
    pub nickname: String,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: Option<String>,
    pub tag_ids: Option<Vec<String>>,
    /// Optional override for the keep-in-touch cadence (days). `None` or `0`
    /// falls back to the importance-derived default (high=30, medium=90, low=180).
    pub keep_in_touch_cadence_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContactInput {
    #[serde(default)]
    pub id: String,
    pub nickname: Option<String>,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub address: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: Option<String>,
    pub tag_ids: Option<Vec<String>>,
    /// Sentiment is "set to this value": `None` = leave unchanged,
    /// `Some(0)` = clear the override (use importance default), `Some(n>0)` =
    /// set the cadence override to `n` days.
    pub keep_in_touch_cadence_days: Option<i64>,
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub contacts: Vec<Contact>,
    pub interactions: Vec<Interaction>,
    pub events: Vec<Event>,
    pub actions: Vec<Action>,
    pub projects: Vec<Project>,
}

// ──────────────────────────────────────────────
// Action inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateActionInput {
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateActionInput {
    #[serde(default)]
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i64>,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
}

// ──────────────────────────────────────────────
// Event inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEventInput {
    pub user_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub reminder_lead_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEventInput {
    #[serde(default)]
    pub id: String,
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub reminder_lead_minutes: Option<i64>,
    pub archived_at: Option<String>,
}

// ──────────────────────────────────────────────
// Interaction inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInteractionInput {
    pub user_id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: String,
    pub channel: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInteractionInput {
    #[serde(default)]
    pub id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: Option<String>,
    pub channel: Option<String>,
    pub summary: Option<String>,
}

// ──────────────────────────────────────────────
// Project inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub template: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectInput {
    #[serde(default)]
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub stage: Option<String>,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub archived_at: Option<String>,
}

// ──────────────────────────────────────────────
// Reminder inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateReminderInput {
    pub user_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub trigger_at: String,
    pub kind: Option<ReminderKind>,
    pub invitation_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateReminderInput {
    #[serde(default)]
    pub id: String,
    pub trigger_at: Option<String>,
    pub kind: Option<ReminderKind>,
    pub dispatched: Option<bool>,
    pub dismissed: Option<bool>,
}

// ──────────────────────────────────────────────
// Tag inputs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTagInput {
    pub user_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTagInput {
    #[serde(default)]
    pub id: String,
    pub name: Option<String>,
}
