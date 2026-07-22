use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ReminderId {
    #[schemars(description = "Reminder UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for reminder listings.")]
pub struct ListRemindersQuery {
    #[schemars(description = "Filter by contact UUID.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Filter by event UUID.")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "Include dismissed reminders. Defaults to false.")]
    #[serde(default)]
    pub include_dismissed: Option<bool>,

    #[schemars(description = "Maximum number of reminders to return.")]
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new reminder.")]
pub struct CreateReminderBody {
    #[schemars(description = "Contact UUID to link.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Event UUID to link.")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "Trigger timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC). Defaults to server time.")]
    #[serde(default)]
    pub trigger_at: Option<String>,

    #[schemars(description = "Reminder kind. Typical values: event, general. Defaults to event.")]
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating a reminder. Pass only fields to change.")]
pub struct UpdateReminderFields {
    #[schemars(description = "Replace the trigger timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub trigger_at: Option<String>,

    #[schemars(description = "Replace the kind.")]
    #[serde(default)]
    pub kind: Option<String>,

    #[schemars(description = "Replace the contact link (UUID).")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Replace the event link (UUID).")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "Mark as dispatched.")]
    #[serde(default)]
    pub dispatched: Option<bool>,

    #[schemars(description = "Mark as dismissed.")]
    #[serde(default)]
    pub dismissed: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_reminder: pick the reminder by id, set only fields to change.")]
pub struct UpdateReminderBody {
    #[schemars(description = "UUID of the reminder to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateReminderFields,
}

impl WeavineMcpServer {
    pub async fn list_reminders(
        &self,
        q: ListRemindersQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = q.contact_id { pairs.push(("contact_id", v)); }
        if let Some(v) = q.event_id { pairs.push(("event_id", v)); }
        if let Some(v) = q.include_dismissed { pairs.push(("include_dismissed", v.to_string())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/reminders", &refs, api!()).await?;
        Ok(v)
    }

    pub async fn get_reminder(
        &self,
        input: ReminderId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/reminders/{}", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn create_reminder(
        &self,
        body: CreateReminderBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/reminders", &body, api!()).await?;
        Ok(v)
    }

    pub async fn update_reminder(
        &self,
        input: UpdateReminderBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.put(&format!("/api/reminders/{}", input.id), &input.fields, api!()).await?;
        Ok(v)
    }

    pub async fn delete_reminder(
        &self,
        input: ReminderId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/reminders/{}", input.id), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
