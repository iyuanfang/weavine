use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct DiagnosticUserInput {
    pub user_id: Option<String>,
}

impl WeavineMcpServer {
    #[tracing::instrument(skip_all, fields(tool = stringify!(diagnostic_user)))]
        pub async fn diagnostic_user(&self,
        _input: DiagnosticUserInput,) -> McpResult<serde_json::Value> {
            Ok(self.client.get("/api/diagnostic/user", &[], api!()).await?)
        }

    #[tracing::instrument(skip_all, fields(tool = stringify!(diagnostic_startup)))]
        pub async fn diagnostic_startup(&self) -> McpResult<serde_json::Value> {
            Ok(self.client.get("/api/diagnostic/startup", &[], api!()).await?)
        }
}
