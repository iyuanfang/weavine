use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::error::McpError;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ContactId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
pub struct ListContactsQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub sort: Option<String>,
}
impl WeavineMcpServer {
    pub async fn list_contacts(
        &self,
        q: ListContactsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = &q.q { pairs.push(("q", v.clone())); }
        if let Some(v) = &q.tag { pairs.push(("tag", v.clone())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        if let Some(v) = &q.sort { pairs.push(("sort", v.clone())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/contacts", &refs, api!()).await?;
        Ok(v)
    }

        pub async fn get_contact(
        &self,
        input: ContactId,
    ) -> McpResult<serde_json::Value> {
        let v = self
            .client
            .get(&format!("/api/contacts/{}", input.id), &[], api!())
            .await?;
        Ok(v)
    }

        pub async fn create_contact(
        &self,
        body: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/contacts", &body, api!()).await?;
        Ok(v)
    }

        pub async fn update_contact(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::BadInput("缺少 id 字段".into()))?
            .to_string();
        let body = input.get("fields").cloned().unwrap_or(serde_json::json!({}));
        let v = self
            .client
            .put(&format!("/api/contacts/{id}"), &body, api!())
            .await?;
        Ok(v)
    }

        pub async fn delete_contact(
        &self,
        input: ContactId,
    ) -> McpResult<serde_json::Value> {
        self.client
            .delete(&format!("/api/contacts/{}", input.id), api!())
            .await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}


