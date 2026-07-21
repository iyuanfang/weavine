use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct AuthLoginInput {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct AuthRegisterInput {
    pub email: String,
    pub password: String,
}

impl WeavineMcpServer {
    pub async fn auth_register(
        &self,
        input: AuthRegisterInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::json!({"email": input.email, "password": input.password});
        Ok(self.client.post_public("/api/auth/register", &body).await?)
    }

    pub async fn auth_login(
        &self,
        input: AuthLoginInput,
    ) -> McpResult<serde_json::Value> {
        let body = serde_json::json!({"email": input.email, "password": input.password});
        Ok(self.client.post_public("/api/auth/login", &body).await?)
    }

    pub async fn auth_logout(&self) -> McpResult<serde_json::Value> {
        Ok(self.client.post_public("/api/auth/logout", &serde_json::Value::Null).await?)
    }
}
