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
    pub city: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: String,
    pub reminder_enabled: bool,
    pub reminder_interval_days: Option<i64>,
    pub last_contacted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[cfg_attr(feature = "sqlx", sqlx(skip))]
    pub tags: Vec<Tag>,
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
pub struct ProjectContactWithContact {
    pub contact: Contact,
    pub role: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
pub struct Reminder {
    pub id: String,
    pub user_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub trigger_at: String,
    pub kind: String,
    pub dispatched: bool,
    pub dismissed: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContactInput {
    pub user_id: String,
    pub nickname: String,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub city: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: Option<String>,
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateContactInput {
    #[serde(default)]
    pub id: String,
    pub nickname: Option<String>,
    pub name: Option<String>,
    pub company: Option<String>,
    pub title: Option<String>,
    pub city: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub wechat: Option<String>,
    pub notes: Option<String>,
    pub importance: Option<String>,
    pub tag_ids: Option<Vec<String>>,
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
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateReminderInput {
    #[serde(default)]
    pub id: String,
    pub trigger_at: Option<String>,
    pub kind: Option<String>,
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
