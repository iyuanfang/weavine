use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SettingDeleteInput {
    #[schemars(description = "Setting key name to delete.")]
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SettingUpsertInput {
    #[schemars(description = "Setting key name.")]
    pub key: String,

    #[schemars(description = "Setting value (any valid JSON).")]
    pub value: serde_json::Value,
}

impl WeavineMcpServer {
    pub async fn list_settings(&self) -> McpResult<serde_json::Value> {
        Ok(self.client.get("/api/settings", &[], api!()).await?)
    }

    pub async fn upsert_setting(
        &self,
        input: SettingUpsertInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::to_value(&input)
            .map_err(|e| crate::error::McpError::Serde(format!("{e}")))?;
        Ok(self.client.post("/api/settings/upsert", &body, api!()).await?)
    }

    pub async fn delete_setting(
        &self,
        input: SettingDeleteInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::json!({"key": input.key});
        let v = self.client.delete_with_body("/api/settings", &body, api!()).await?;
        Ok(v)
    }
}
