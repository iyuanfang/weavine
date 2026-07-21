pub mod client;
pub mod config;
pub mod error;
pub mod server;
pub mod tools;

use std::sync::Arc;

use anyhow::Context;
use rmcp::{ServiceExt, transport::stdio};

use crate::config::Config;
use crate::server::WeavineMcpServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,weavine_mcp=info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let cfg = Arc::new(Config::from_env().context("配置加载失败")?);
    tracing::info!(
        base_url = %cfg.base_url,
        tier = ?cfg.tier,
        "weavine-mcp starting"
    );

    let server = WeavineMcpServer::new(cfg)?;
    let service = server.serve(stdio()).await.context("stdio serve")?;
    service.waiting().await.context("stdio wait")?;
    Ok(())
}
