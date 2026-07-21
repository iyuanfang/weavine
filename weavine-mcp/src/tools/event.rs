use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::error::McpError;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct EventId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
pub struct ListEventsQuery {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub contact_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}
impl WeavineMcpServer {
    pub async fn upcoming_events(&self) -> McpResult<serde_json::Value> {
        let v = self.client.get("/api/events/upcoming", &[]).await?;
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
        let v = self.client.get("/api/events", &refs).await?;
        Ok(v)
    }

        pub async fn get_event(
        &self,
        input: EventId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/events/{}", input.id), &[]).await?;
        Ok(v)
    }

        pub async fn create_event(
        &self,
        body: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/events", &body).await?;
        Ok(v)
    }

        pub async fn update_event(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::BadInput("缺少 id 字段".into()))?
            .to_string();
        let body = input.get("fields").cloned().unwrap_or(serde_json::json!({}));
        let v = self.client.put(&format!("/api/events/{id}"), &body).await?;
        Ok(v)
    }

        pub async fn delete_event(
        &self,
        input: EventId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/events/{}", input.id)).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}


