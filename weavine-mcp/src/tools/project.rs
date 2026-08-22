use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ProjectId {
    #[schemars(description = "Project UUID.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Filter parameters for project listings.")]
pub struct ListProjectsQuery {
    #[schemars(description = "Filter by stage.")]
    #[serde(default)]
    pub status: Option<String>,

    #[schemars(description = "Filter by contact UUID.")]
    #[serde(default)]
    pub contact_id: Option<String>,

    #[schemars(description = "Maximum number of projects to return.")]
    #[serde(default)]
    pub limit: Option<u32>,

    #[schemars(description = "Pagination offset (skip N results).")]
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Project-contact link identifiers.")]
pub struct ProjectContactIds {
    #[schemars(description = "Project UUID.")]
    pub project_id: String,

    #[schemars(description = "Contact UUID.")]
    pub contact_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Body for creating a new project.")]
pub struct CreateProjectBody {
    #[schemars(description = "Project title.")]
    pub title: String,

    #[schemars(description = "Project description.")]
    #[serde(default)]
    pub description: Option<String>,

    #[schemars(description = "Project template. Values: general, sales, product_dev. Defaults to general.")]
    #[serde(default)]
    pub template: Option<String>,

    #[schemars(description = "Start timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub start_at: Option<String>,

    #[schemars(description = "Due timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub due_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema, Default)]
#[schemars(description = "Mutable fields for updating a project. Pass only fields to change.")]
pub struct UpdateProjectFields {
    #[schemars(description = "Replace the title.")]
    #[serde(default)]
    pub title: Option<String>,

    #[schemars(description = "Replace the description.")]
    #[serde(default)]
    pub description: Option<String>,

    #[schemars(description = "Replace the stage. Stages depend on template: general=[待启动,进行中,待收尾,已完成], sales=[线索,商机,沟通,报价,丢单,中标], product_dev=[立项,设计,开发,发布,推广,终止].")]
    #[serde(default)]
    pub stage: Option<String>,

    #[schemars(description = "Replace the start timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub start_at: Option<String>,

    #[schemars(description = "Replace the due timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub due_at: Option<String>,

    #[schemars(description = "Completion timestamp. Format: \"YYYY-MM-DD HH:MM:SS\" (UTC).")]
    #[serde(default)]
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for update_project: pick the project by id, set only fields to change.")]
pub struct UpdateProjectBody {
    #[schemars(description = "UUID of the project to update.")]
    pub id: String,

    #[schemars(description = "Mutable field overrides. Only fields set will be written.")]
    pub fields: UpdateProjectFields,
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
        let v = self.client.get("/api/projects", &refs, api!()).await?;
        Ok(v)
    }

    pub async fn get_project(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/projects/{}", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn create_project(
        &self,
        body: CreateProjectBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post("/api/projects", &body, api!()).await?;
        Ok(v)
    }

    pub async fn update_project(
        &self,
        input: UpdateProjectBody,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.put(&format!("/api/projects/{}", input.id), &input.fields, api!()).await?;
        Ok(v)
    }

    pub async fn delete_project(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!("/api/projects/{}", input.id), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }

    pub async fn list_project_contacts(
        &self,
        input: ProjectId,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.get(&format!("/api/projects/{}/contacts", input.id), &[], api!()).await?;
        Ok(v)
    }

    pub async fn add_project_contact(
        &self,
        input: ProjectContactIds,
    ) -> McpResult<serde_json::Value> {
        let v = self.client.post(
            &format!("/api/projects/{}/contacts", input.project_id),
            &serde_json::json!({ "contact_id": input.contact_id }),
            api!()).await?;
        Ok(v)
    }

    pub async fn remove_project_contact(
        &self,
        input: ProjectContactIds,
    ) -> McpResult<serde_json::Value> {
        self.client.delete(&format!(
            "/api/projects/{}/contacts/{}", input.project_id, input.contact_id
        ), api!()).await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}
