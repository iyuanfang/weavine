use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for tag listings.")]
pub struct ListTagsQuery {
    #[schemars(description = "Search query (matches tag name).")]
    #[serde(default)]
    pub q: Option<String>,

    #[schemars(description = "Maximum number of tags to return.")]
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct TagId {
    #[schemars(description = "Tag UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new tag.")]
pub struct CreateTagBody {
    #[schemars(description = "Tag name. Must be unique per user.")]
    pub name: String,

    #[schemars(description = "Optional color (hex string or CSS color name).")]
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating a tag. Pass only fields to change.")]
pub struct UpdateTagFields {
    #[schemars(description = "Replace the tag name. Must be present for the update to take effect.")]
    #[serde(default)]
    pub name: Option<String>,

    #[schemars(description = "Replace the color.")]
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_tag: pick the tag by id, set only fields to change.")]
pub struct UpdateTagBody {
    #[schemars(description = "UUID of the tag to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateTagFields,
}

impl WeavineMcpServer {
    pub async fn list_tags(
        &self,
        q: ListTagsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = q.q { pairs.push(("q", v)); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Ok(self.client.get("/api/tags", &refs, api!()).await?)
    }

    pub async fn create_tag(
        &self,
        body: CreateTagBody,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/tags", &body, api!()).await?)
    }

    pub async fn update_tag(
        &self,
        input: UpdateTagBody,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.put(&format!("/api/tags/{}", input.id), &input.fields, api!()).await?)
    }

    pub async fn delete_tag(
        &self,
        input: TagId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.delete(&format!("/api/tags/{}", input.id), api!()).await?;
        Ok(v)
    }
}
