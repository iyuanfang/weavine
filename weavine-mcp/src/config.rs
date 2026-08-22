use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Tier {
    #[default]
    Default,
    Full,
}

impl Tier {
    pub fn from_env() -> Self {
        match std::env::var("WEAVINE_MCP_TIER").as_deref() {
            Ok("full") | Ok("FULL") | Ok("tier2") => Tier::Full,
            _ => Tier::Default,
        }
    }

    pub fn is_full(&self) -> bool {
        matches!(self, Tier::Full)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Transport {
    #[default]
    Stdio,
    Http,
}

impl Transport {
    pub fn from_env() -> Self {
        match std::env::var("WEAVINE_MCP_TRANSPORT").as_deref() {
            Ok("http") | Ok("HTTP") | Ok("sse") | Ok("streamable-http") | Ok("streamable_http") => {
                Transport::Http
            }
            _ => Transport::Stdio,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub base_url: String,
    pub tier: Tier,
    pub transport: Transport,
    pub http_bind: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let base_url = std::env::var("WEAVINE_MCP_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3000".to_string());
        let tier = Tier::from_env();
        let transport = Transport::from_env();
        let http_bind = std::env::var("WEAVINE_MCP_HTTP_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3001".to_string());
        Ok(Config {
            base_url: base_url.trim_end_matches('/').to_string(),
            tier,
            transport,
            http_bind,
        })
    }
}

pub type SharedConfig = Arc<Config>;
