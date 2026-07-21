use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::error::McpError;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ActionId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
pub struct ListActionsQuery {
    #[serde(default)]
    pub contact_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}
impl WeavineMcpServer {
        pub async fn list_actions(
        &self,
        q: ListActionsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
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
        body: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/actions", &body, api!()).await?;
        Ok(v)
    }

        pub async fn update_action(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::BadInput("缺少 id 字段".into()))?
            .to_string();
        let body = input.get("fields").cloned().unwrap_or(serde_json::json!({}));
        let v = self.client.put(&format!("/api/actions/{id}"), &body, api!()).await?;
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


