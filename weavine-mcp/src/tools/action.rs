use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ActionId {
    #[schemars(description = "Action UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for action listings.")]
pub struct ListActionsQuery {
    #[schemars(description = "Include archived actions. Defaults to false.")]
    #[serde(default)]
    pub include_archived: Option<bool>,

    #[schemars(description = "Filter by contact UUID.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Filter by project UUID.")]
    #[serde(default)]
    pub project_id: Option<String>,

    #[schemars(description = "Filter by status. One of: todo, next, in_progress, done, inbox.")]
    #[serde(default)]
    pub status: Option<String>,

    #[schemars(description = "Maximum number of actions to return.")]
    #[serde(default)]
    pub limit: Option<u32>,

    #[schemars(description = "Pagination offset (skip N results).")]
    #[serde(default)]
    pub offset: Option<u32>,
}

/// Body for `create_action`. All fields except `title` are optional; server
/// fills in `user_id`, `created_at`, `updated_at`, and the action `id`.
#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new action item.")]
pub struct CreateActionBody {
    #[schemars(description = "Action title. Required; non-empty.")]
    pub title: String,

    #[schemars(description = "Optional longer description.")]
    #[serde(default)]
    pub description: Option<String>,

    #[schemars(description = "Workflow status. Typical values: inbox, next, todo, in_progress, done. Defaults to inbox.")]
    #[serde(default)]
    pub status: Option<String>,

    #[schemars(description = "Priority 0-5 (0=lowest, 5=highest). Defaults to 0.")]
    #[serde(default)]
    pub priority: Option<i32>,

    #[schemars(description = "Free-form category label.")]
    #[serde(default)]
    pub category: Option<String>,

    #[schemars(description = "Optional deadline. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub due_at: Option<String>,

    #[schemars(description = "Optional contact UUID to link this action to.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Optional project UUID to link this action to.")]
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Mutable fields accepted by `update_action`. Server-controlled fields
/// (`id`, `user_id`, `created_at`) are not allowed here.
#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating an action. Pass only fields to change.")]
pub struct UpdateActionFields {
    #[schemars(description = "Replace the title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "Replace the description.")]
    #[serde(default)]
    pub description: Option<String>,

    #[schemars(description = "New status. Typical values: inbox, next, todo, in_progress, done.")]
    #[serde(default)]
    pub status: Option<String>,

    #[schemars(description = "New priority 0-5.")]
    #[serde(default)]
    pub priority: Option<i32>,

    #[schemars(description = "Replace the category label.")]
    #[serde(default)]
    pub category: Option<String>,

    #[schemars(description = "Replace the deadline. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub due_at: Option<String>,

    #[schemars(description = "Replace the contact link (UUID). Pass null to unlink.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Replace the project link (UUID). Pass null to unlink.")]
    #[serde(default)]
    pub project_id: Option<String>,

    #[schemars(description = "Mark completed-at timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub completed_at: Option<String>,

    #[schemars(description = "Mark archived-at timestamp to soft-delete. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_action: pick the action by id, set only fields to change.")]
pub struct UpdateActionBody {
    #[schemars(description = "UUID of the action to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateActionFields,
}

impl WeavineMcpServer {
    pub async fn list_actions(
        &self,
        q: ListActionsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        pairs.push(("archived", if q.include_archived.unwrap_or(false) { "true".to_string() } else { "false".to_string() }));
        if let Some(v) = &q.contact_id { pairs.push(("contact_id", v.clone())); }
        if let Some(v) = &q.project_id { pairs.push(("project_id", v.clone())); }
        if let Some(v) = &q.status { pairs.push(("status", v.clone())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/actions", &refs, api!()).await?;
        Ok(v)
    }

    pub async fn get_action(
        &self,
        input: ActionId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/actions/{}", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn create_action(
        &self,
        body: CreateActionBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/actions", &body, api!()).await?;
        Ok(v)
    }

    pub async fn update_action(
        &self,
        input: UpdateActionBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.put(&format!("/api/actions/{}", input.id), &input.fields, api!()).await?;
        Ok(v)
    }

    pub async fn delete_action(
        &self,
        input: ActionId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/actions/{}", input.id), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
