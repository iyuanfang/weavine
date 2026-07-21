use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListTagsQuery {
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct TagId {
    pub id: String,
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
        Ok(self.client.get("/api/tags", &refs).await?)
    }

    pub async fn create_tag(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/tags", &input).await?)
    }

    pub async fn update_tag(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        Ok(self.client.put(&format!("/api/tags/{}", id), &input).await?)
    }

    pub async fn delete_tag(
        &self,
        input: TagId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.delete(&format!("/api/tags/{}", input.id)).await?;
        Ok(v)
    }
}
