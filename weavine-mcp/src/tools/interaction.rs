use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListInteractionsQuery {
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub kind: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct InteractionId {
    pub id: String,
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
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/interactions", &input, api!()).await?)
    }

    pub async fn update_interaction(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        Ok(self.client.put(&format!("/api/interactions/{}", id), &input, api!()).await?)
    }

    pub async fn delete_interaction(
        &self,
        input: InteractionId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.delete(&format!("/api/interactions/{}", input.id), api!()).await?;
        Ok(v)
    }
}
