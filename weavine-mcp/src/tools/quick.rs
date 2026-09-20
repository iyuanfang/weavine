use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::McpResult;
use crate::server::WeavineMcpServer;
use crate::api;

/// Body for `quick_parse`. Parses free-form text (Ctrl+K style) into a
/// structured `QuickItem` the server's quick-capture understands.
///
/// Pass `contact_names` so the parser can resolve nicknames into
/// existing `contact_id`s (scoped to the caller's user_id on the server).
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[schemars(description = "Body for quick_parse. Parses free-form text into a structured QuickItem.")]
pub struct QuickParseBody {
    #[schemars(description = "Free-form text to parse, e.g. \"coffee with @alice tomorrow 3pm\".")]
    pub text: String,

    #[schemars(description = "Optional contact nicknames to resolve against the caller's contacts. Empty array means no nickname resolution.")]
    #[serde(default)]
    pub contact_names: Vec<String>,
}

impl WeavineMcpServer {
    /// Parse natural-language text into a structured `QuickItem`. Useful
    /// for an LLM agent that needs to turn "lunch with @bob friday at the
    /// usual place" into a structured event/action before persisting.
    #[tracing::instrument(skip_all, fields(tool = stringify!(quick_parse)))]
    pub async fn quick_parse(
        &self,
        body: QuickParseBody,
    ) -> McpResult<serde_json::Value> {
        self.client.post("/api/quick/parse", &body, api!()).await
    }
}