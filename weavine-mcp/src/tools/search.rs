use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SearchQuery {
    pub q: String,
    pub entities: Option<Vec<String>>,
    pub limit: Option<i64>,
}

impl WeavineMcpServer {
    pub async fn search(
        &self,
        q: SearchQuery,
    ) -> McpResult<serde_json::Value> {
        let mut pairs: Vec<(&str, String)> = Vec::new();
        pairs.push(("q", q.q));
        if let Some(v) = q.limit { pairs.push(("limit", v.to_string())); }
        if let Some(ents) = q.entities {
            for e in ents { pairs.push(("entities", e)); }
        }
        let refs: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Ok(self.client.get("/api/search", &refs).await?)
    }
}
