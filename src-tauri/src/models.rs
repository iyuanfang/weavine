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
pub struct Contact {
    pub id: String,
    pub owner_id: String,
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
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub owner_id: String,
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interaction {
    pub id: String,
    pub owner_id: String,
    pub contact_id: Option<String>,
    pub action_id: Option<String>,
    pub event_id: Option<String>,
    pub occurred_at: String,
    pub channel: Option<String>,
    pub summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub owner_id: String,
    pub title: String,
    pub description: Option<String>,
    pub template: String,
    pub stage: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub id: String,
    pub owner_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: i64,
    pub category: Option<String>,
    pub due_at: Option<String>,
    pub contact_id: Option<String>,
    pub project_id: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub owner_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub trigger_at: String,
    pub kind: String,
    pub dispatched: bool,
    pub dismissed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub id: String,
    pub owner_id: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

// ──────────────────────────────────────────────
// Query DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListContactsParams {
    pub owner_id: String,
    pub tag_id: Option<String>,
    pub search: Option<String>,
    pub importance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContactInput {
    pub owner_id: String,
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
}
