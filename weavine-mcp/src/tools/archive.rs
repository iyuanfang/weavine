use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ArchiveListQuery {
    #[schemars(description = "Entity type to filter. One of: action, event, contact, project, reminder, interaction, tag.")]
    #[serde(default)]
    pub entity: Option<String>,

    #[schemars(description = "Maximum items to return.")]
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ArchiveUnarchiveInput {
    #[schemars(description = "Entity type. One of: action, event, contact, project, reminder, interaction, tag.")]
    pub entity: String,

    #[schemars(description = "Item UUID to unarchive.")]
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ArchiveBulkUnarchiveInput {
    #[schemars(description = "Entity type. One of: action, event, contact, project, reminder, interaction, tag.")]
    pub entity: String,

    #[schemars(description = "List of item UUIDs to unarchive.")]
    pub ids: Vec<String>,
}

impl WeavineMcpServer {
    pub async fn archive_summary(&self) -> McpResult<serde_json::Value> {
        Ok(self.client.get("/api/archive/summary", &[], api!()).await?)
    }

    pub async fn archive_counts(&self) -> McpResult<serde_json::Value> {
        Ok(self.client.get("/api/archive/counts", &[], api!()).await?)
    }

    pub async fn archive_list(
        &self,
        q: ArchiveListQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        if let Some(v) = q.entity { pairs.push(("entity", v)); }
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Ok(self.client.get("/api/archive/list", &refs, api!()).await?)
    }

    pub async fn archive_unarchive_one(
        &self,
        input: ArchiveUnarchiveInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::json!({"entity": input.entity, "id": input.id});
        Ok(self.client.post("/api/archive/unarchive-one", &body, api!()).await?)
    }

    pub async fn archive_bulk_unarchive(
        &self,
        input: ArchiveBulkUnarchiveInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::to_value(&input)
            .map_err(|e| crate::error::McpError::Serde(format!("{e}")))?;
        Ok(self.client.post("/api/archive/bulk-unarchive", &body, api!()).await?)
    }
}
