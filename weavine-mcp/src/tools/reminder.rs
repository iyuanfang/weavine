use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{McpError, McpResult};
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ReminderId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ListRemindersQuery {
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub include_dismissed: Option<bool>,
    pub limit: Option<i64>,
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
        let v = self.client.get("/api/reminders", &refs).await?;
        Ok(v)
    }

    pub async fn get_reminder(
        &self,
        input: ReminderId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/reminders/{}", input.id), &[]).await?;
        Ok(v)
    }

    pub async fn create_reminder(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/reminders", &input).await?;
        Ok(v)
    }

    pub async fn update_reminder(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let body = input.clone();
        let v = self.client.put(&format!("/api/reminders/{}", id), &body).await?;
        Ok(v)
    }

    pub async fn delete_reminder(
        &self,
        input: ReminderId,
    ) -> McpResult<serde_json::Value> {
        self.client
            .delete(&format!("/api/reminders/{}", input.id))
            .await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
