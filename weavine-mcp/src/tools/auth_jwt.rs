use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct AuthLoginInput {
    #[schemars(description = "User email address.")]
    pub email: String,

    #[schemars(description = "User password (plaintext, transmitted over HTTPS).")]
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct AuthRegisterInput {
    #[schemars(description = "User email address.")]
    pub email: String,

    #[schemars(description = "User password (plaintext, transmitted over HTTPS).")]
    pub password: String,
}

impl WeavineMcpServer {
    #[tracing::instrument(skip_all, fields(tool = stringify!(auth_register)))]
        pub async fn auth_register(&self,
        input: AuthRegisterInput,) -> McpResult<serde_json::Value> {
            let body = serde_json::json!({"email": input.email, "password": input.password});
            self.client.post_public("/api/auth/register", &body).await
        }

    #[tracing::instrument(skip_all, fields(tool = stringify!(auth_login)))]
        pub async fn auth_login(&self,
        input: AuthLoginInput,) -> McpResult<serde_json::Value> {
            let body = serde_json::json!({"email": input.email, "password": input.password});
            self.client.post_public("/api/auth/login", &body).await
        }

    #[tracing::instrument(skip_all, fields(tool = stringify!(auth_logout)))]
        pub async fn auth_logout(&self) -> McpResult<serde_json::Value> {
            self.client.post_public("/api/auth/logout", &serde_json::Value::Null).await
        }
}
