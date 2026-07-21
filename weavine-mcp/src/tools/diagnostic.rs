use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct DiagnosticUserInput {
    pub user_id: Option<String>,
}

impl WeavineMcpServer {
    pub async fn diagnostic_user(
        &self,
        _input: DiagnosticUserInput,
    ) -> McpResult<serde_json::Value> {
        Ok(self.client.get("/api/diagnostic/user", &[]).await?)
    }

    pub async fn diagnostic_startup(&self) -> McpResult<serde_json::Value> {
        Ok(self.client.get("/api/diagnostic/startup", &[]).await?)
    }
}
