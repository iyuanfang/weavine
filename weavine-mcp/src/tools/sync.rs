use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncManifestInput {
    pub device_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncPullInput {
    pub device_id: String,
    pub since: Option<String>,
}

impl WeavineMcpServer {
    #[tracing::instrument(skip_all, fields(tool = stringify!(sync_manifest)))]
        pub async fn sync_manifest(&self,
        _input: SyncManifestInput,) -> McpResult<serde_json::Value> {
            self.client.post("/api/sync/manifest", &serde_json::Value::Null, api!()).await
        }

    #[tracing::instrument(skip_all, fields(tool = stringify!(sync_pull)))]
        pub async fn sync_pull(&self,
        input: SyncPullInput,) -> McpResult<serde_json::Value> {
            let mut body = serde_json::json!({"device_id": input.device_id});
            if let Some(s) = input.since {
                body["since"] = serde_json::Value::String(s);
            }
            self.client.post("/api/sync/pull", &body, api!()).await
        }
}
