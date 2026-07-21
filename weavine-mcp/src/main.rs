pub mod client;
pub mod config;
pub mod error;
pub mod server;
pub mod tools;

use std::sync::Arc;

use anyhow::Context;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager,
    tower::{StreamableHttpServerConfig, StreamableHttpService},
};
use rmcp::ServiceExt;

use crate::config::{Config, Transport};
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
        transport = ?cfg.transport,
        http_bind = %cfg.http_bind,
        "weavine-mcp starting"
    );

    match cfg.transport {
        Transport::Stdio => run_stdio(cfg).await,
        Transport::Http => run_http(cfg).await,
    }
}

async fn run_stdio(cfg: Arc<Config>) -> anyhow::Result<()> {
    let server = WeavineMcpServer::new(cfg)?;
    let service = server
        .serve(rmcp::transport::stdio())
        .await
        .context("stdio serve")?;
    service.waiting().await.context("stdio wait")?;
    Ok(())
}

async fn run_http(cfg: Arc<Config>) -> anyhow::Result<()> {
    let bind: std::net::SocketAddr = cfg
        .http_bind
        .parse()
        .with_context(|| format!("WEAVINE_MCP_HTTP_BIND 无效: {}", cfg.http_bind))?;

    let cfg_for_factory = cfg.clone();
    let mut svc_config = StreamableHttpServerConfig::default();
    if let Ok(extra) = std::env::var("WEAVINE_MCP_ALLOWED_HOSTS") {
        svc_config.allowed_hosts = extra.split(',').map(|s| s.trim().to_string()).collect();
    }
    svc_config.stateful_mode = false;
    svc_config.json_response = true;
    let svc = StreamableHttpService::new(
        move || {
            Ok(WeavineMcpServer::new(cfg_for_factory.clone())
                .expect("weavine-mcp init"))
        },
        Arc::new(LocalSessionManager::default()),
        svc_config,
    );
    let router: axum::Router = axum::Router::new().fallback_service(svc);
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("无法 bind {bind}"))?;
    tracing::info!(%bind, "weavine-mcp streamable-http 上线 (POST/GET /mcp)");

    let server = axum::serve(listener, router);
    tokio::select! {
        _ = server => {},
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Ctrl-C 收到，关闭...");
        }
    }
    Ok(())
}
