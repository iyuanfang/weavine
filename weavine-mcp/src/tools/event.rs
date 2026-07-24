use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct EventId {
    #[schemars(description = "Event UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for event listings.")]
pub struct ListEventsQuery {
    #[schemars(description = "Filter events starting from this timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub from: Option<String>,

    #[schemars(description = "Filter events ending before this timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub to: Option<String>,

    #[schemars(description = "Filter by contact UUID.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Filter by project UUID.")]
    #[serde(default)]
    pub project_id: Option<String>,

    #[schemars(description = "Maximum number of events to return.")]
    #[serde(default)]
    pub limit: Option<u32>,

    #[schemars(description = "Pagination offset (skip N results).")]
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new event.")]
pub struct CreateEventBody {
    #[schemars(description = "Event title.")]
    pub title: String,

    #[schemars(description = "Event type. Typical values: event, meeting, call, deadline. Defaults to \"event\". Sent as JSON key \"type\".")]
    #[serde(default, rename = "type")]
    pub event_type: Option<String>,

    #[schemars(description = "Start timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC). Defaults to server time.")]
    #[serde(default)]
    pub start_at: Option<String>,

    #[schemars(description = "End timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub end_at: Option<String>,

    #[schemars(description = "Location text.")]
    #[serde(default)]
    pub location: Option<String>,

    #[schemars(description = "Notes for the event.")]
    #[serde(default)]
    pub notes: Option<String>,

    #[schemars(description = "Contact UUID to link.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Project UUID to link.")]
    #[serde(default)]
    pub project_id: Option<String>,

    #[schemars(description = "Minutes before start to trigger a reminder.")]
    #[serde(default)]
    pub reminder_lead_minutes: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating an event. Pass only fields to change.")]
pub struct UpdateEventFields {
    #[schemars(description = "Replace the title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "Replace the event type.")]
    #[serde(default)]
    pub event_type: Option<String>,

    #[schemars(description = "Replace the start timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub start_at: Option<String>,

    #[schemars(description = "Replace the end timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub end_at: Option<String>,

    #[schemars(description = "Replace the location.")]
    #[serde(default)]
    pub location: Option<String>,

    #[schemars(description = "Replace the notes.")]
    #[serde(default)]
    pub notes: Option<String>,

    #[schemars(description = "Replace the contact link (UUID).")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Replace the project link (UUID).")]
    #[serde(default)]
    pub project_id: Option<String>,

    #[schemars(description = "Replace reminder lead minutes.")]
    #[serde(default)]
    pub reminder_lead_minutes: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_event: pick the event by id, set only fields to change.")]
pub struct UpdateEventBody {
    #[schemars(description = "UUID of the event to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateEventFields,
}

impl WeavineMcpServer {
    pub async fn upcoming_events(&self) -> McpResult<serde_json::Value> {
        let v = self.client.get("/api/events/upcoming", &[], api!()).await?;
        Ok(v)
    }

    pub async fn list_events(
        &self,
        q: ListEventsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = &q.from { pairs.push(("from", v.clone())); }
        if let Some(v) = &q.to { pairs.push(("to", v.clone())); }
        if let Some(v) = &q.contact_id { pairs.push(("contact_id", v.clone())); }
        if let Some(v) = &q.project_id { pairs.push(("project_id", v.clone())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/events", &refs, api!()).await?;
        Ok(v)
    }

    pub async fn get_event(
        &self,
        input: EventId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/events/{}", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn create_event(
        &self,
        body: CreateEventBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/events", &body, api!()).await?;
        Ok(v)
    }

    pub async fn update_event(
        &self,
        input: UpdateEventBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.put(&format!("/api/events/{}", input.id), &input.fields, api!()).await?;
        Ok(v)
    }

    pub async fn delete_event(
        &self,
        input: EventId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/events/{}", input.id), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
