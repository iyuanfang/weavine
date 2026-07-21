use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncManifestInput {
    pub device_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncPushInput {
    pub device_id: String,
    pub changes: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncPullInput {
    pub device_id: String,
    pub since: Option<String>,
}

impl WeavineMcpServer {
    pub async fn sync_manifest(
        &self,
        _input: SyncManifestInput,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/sync/manifest", &serde_json::Value::Null).await?)
    }

    pub async fn sync_push(
        &self,
        input: SyncPushInput,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.post("/api/sync/push", &serde_json::json!({
            "device_id": input.device_id,
            "changes": input.changes,
        })).await?)
    }

    pub async fn sync_pull(
        &self,
        input: SyncPullInput,
    ) -> McpResult<serde_json::Value> {
        let mut body = serde_json::json!({"device_id": input.device_id});
        if let Some(s) = input.since {
            body["since"] = serde_json::Value::String(s);
        }
        Ok(self.client.post("/api/sync/pull", &body).await?)
    }
}
