use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ProjectId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
pub struct ListProjectsQuery {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub contact_id: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ProjectContactIds {
    pub project_id: String,
    pub contact_id: String,
}
impl WeavineMcpServer {
        pub async fn list_projects(
        &self,
        q: ListProjectsQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = &q.status { pairs.push(("status", v.clone())); }
        if let Some(v) = &q.contact_id { pairs.push(("contact_id", v.clone())); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(v) = q.offset { pairs.push(("offset", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let v = self.client.get("/api/projects", &refs).await?;
        Ok(v)
    }

        pub async fn get_project(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/projects/{}", input.id), &[]).await?;
        Ok(v)
    }

        pub async fn create_project(
        &self,
        body: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/projects", &body).await?;
        Ok(v)
    }

        pub async fn update_project(
        &self,
        input: serde_json::Value,
    ) -> McpResult<serde_json::Value> {
        let id = input.get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::BadInput("缺少 id 字段".into()))?
            .to_string();
        let body = input.get("fields").cloned().unwrap_or(serde_json::json!({}));
        let v = self.client.put(&format!("/api/projects/{id}"), &body).await?;
        Ok(v)
    }

        pub async fn delete_project(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/projects/{}", input.id)).await?;
        Ok(serde_json::json!({ "ok": true }))
    }

        pub async fn list_project_contacts(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        let v = self
            .client
            .get(&format!("/api/projects/{}/contacts", input.id), &[])
            .await?;
        Ok(v)
    }

        pub async fn add_project_contact(
        &self,
        input: ProjectContactIds,
    ) -> McpResult<serde_json::Value> {
        let v = self
            .client
            .post(
                &format!("/api/projects/{}/contacts", input.project_id),
                &serde_json::json!({ "contact_id": input.contact_id }),
            )
            .await?;
        Ok(v)
    }

        pub async fn remove_project_contact(
        &self,
        input: ProjectContactIds,
    ) -> McpResult<serde_json::Value> {
        self.client
            .delete(&format!(
                "/api/projects/{}/contacts/{}",
                input.project_id, input.contact_id
            ))
            .await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}


