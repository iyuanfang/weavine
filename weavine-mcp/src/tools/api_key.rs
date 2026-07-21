use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{McpError, McpResult};
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ApiKeyId {
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CreateApiKeyInput {
    pub name: String,
}
impl WeavineMcpServer {
    pub async fn list_api_keys(&self) -> McpResult<serde_json::Value> {
        let v = self.client.get("/api/api_keys", &[]).await?;
        Ok(v)
    }

        pub async fn create_api_key(
        &self,
        input: CreateApiKeyInput,
    ) -> McpResult<serde_json::Value> {
        let v = self
            .client
            .post("/api/api_keys", &serde_json::json!({ "name": input.name }))
            .await?;
        Ok(v)
    }

        pub async fn revoke_api_key(
        &self,
        input: ApiKeyId,
    ) -> McpResult<serde_json::Value> {
        self.client
            .delete(&format!("/api/api_keys/{}", input.id))
            .await?;
        Ok(serde_json::json!({ "ok": true }))
    }
}


