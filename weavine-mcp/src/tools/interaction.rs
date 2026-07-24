use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for interaction listings.")]
pub struct ListInteractionsQuery {
    #[schemars(description = "Filter by contact UUID.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Filter by event UUID.")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "Filter by channel. Typical values: meeting, call, email, chat, social, other.")]
    #[serde(default)]
    pub kind: Option<String>,

    #[schemars(description = "Maximum number of interactions to return.")]
    #[serde(default)]
    pub limit: Option<i64>,

    #[schemars(description = "Pagination offset (skip N results).")]
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct InteractionId {
    #[schemars(description = "Interaction UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new interaction.")]
pub struct CreateInteractionBody {
    #[schemars(description = "Contact UUID. If set, updates the contact's last_contacted_at.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Action UUID to link.")]
    #[serde(default)]
    pub action_id: Option<String>,

    #[schemars(description = "Event UUID to link.")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "When the interaction occurred. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC). Defaults to server time.")]
    #[serde(default)]
    pub occurred_at: Option<String>,

    #[schemars(description = "Channel. Typical values: meeting, call, email, chat, social, other.")]
    #[serde(default)]
    pub channel: Option<String>,

    #[schemars(description = "Summary of the interaction.")]
    pub summary: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating an interaction. Pass only fields to change.")]
pub struct UpdateInteractionFields {
    #[schemars(description = "Replace the contact link (UUID).")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Replace the action link (UUID).")]
    #[serde(default)]
    pub action_id: Option<String>,

    #[schemars(description = "Replace the event link (UUID).")]
    #[serde(default)]
    pub event_id: Option<String>,

    #[schemars(description = "Replace the occurred-at timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub occurred_at: Option<String>,

    #[schemars(description = "Replace the channel.")]
    #[serde(default)]
    pub channel: Option<String>,

    #[schemars(description = "Replace the summary.")]
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_interaction: pick the interaction by id, set only fields to change.")]
pub struct UpdateInteractionBody {
    #[schemars(description = "UUID of the interaction to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateInteractionFields,
}

impl WeavineMcpServer {
    pub async fn list_interactions(
        &self,
        q: ListInteractionsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = q.contact_id { pairs.push(("contact_id", v)); }
        if let Some(v) = q.event_id { pairs.push(("event_id", v)); }
        if let Some(v) = q.kind { pairs.push(("kind", v)); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Ok(self.client.get("/api/interactions", &refs, api!()).await?)
    }

    pub async fn get_interaction(
        &self,
        input: InteractionId,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.get(&format!("/api/interactions/{}", input.id), &[], api!()).await?)
    }

    pub async fn create_interaction(
        &self,
        body: CreateInteractionBody,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/interactions", &body, api!()).await?)
    }

    pub async fn update_interaction(
        &self,
        input: UpdateInteractionBody,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.put(&format!("/api/interactions/{}", input.id), &input.fields, api!()).await?)
    }

    pub async fn delete_interaction(
        &self,
        input: InteractionId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.delete(&format!("/api/interactions/{}", input.id), api!()).await?;
        Ok(v)
    }
}
