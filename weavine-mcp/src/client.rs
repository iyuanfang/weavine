use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::Value;
use tokio::time::sleep;
use tracing::{debug, warn};

use crate::config::SharedConfig;
use crate::error::{McpError, McpResult};

#[derive(Debug, Clone)]
pub struct WeavineClient {
    http: Client,
    cfg: SharedConfig,
}

impl WeavineClient {
    pub fn new(cfg: SharedConfig) -> anyhow::Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("weavine-mcp/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| anyhow::anyhow!("reqwest builder: {e}"))?;
        Ok(Self { http, cfg })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.cfg.base_url, path)
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&self.cfg.api_key) {
            h.insert("X-API-Key", v);
        }
        h
    }

    pub async fn get(&self, path: &str, query: &[(&str, &str)]) -> McpResult<Value> {
        let mut attempts = 0u8;
        loop {
            attempts += 1;
            let url = self.url(path);
            let req = self
                .http
                .get(&url)
                .headers(self.auth_headers())
                .query(query);
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    if status.is_success() {
                        return serde_json::from_str(&body)
                            .map_err(|e| McpError::Serde(format!("{e}: {body}")));
                    }
                    if should_retry_status(status) && attempts < 3 {
                        warn!(%status, path, "retrying 5xx");
                        sleep(backoff(attempts)).await;
                        continue;
                    }
                    return Err(McpError::http(status.as_u16(), body));
                }
                Err(e) if (e.is_timeout() || e.is_connect()) && attempts < 3 => {
                    debug!(error = %e, path, "transport retry");
                    sleep(backoff(attempts)).await;
                    continue;
                }
                Err(e) => return Err(McpError::Request(e.to_string())),
            }
        }
    }

    pub async fn post(&self, path: &str, body: &Value) -> McpResult<Value> {
        self.send_with_body(reqwest::Method::POST, path, body).await
    }

    pub async fn put(&self, path: &str, body: &Value) -> McpResult<Value> {
        self.send_with_body(reqwest::Method::PUT, path, body).await
    }

    pub async fn delete(&self, path: &str) -> McpResult<Value> {
        let mut attempts = 0u8;
        loop {
            attempts += 1;
            let url = self.url(path);
            let req = self
                .http
                .delete(&url)
                .headers(self.auth_headers());
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    if status == StatusCode::NO_CONTENT || text.is_empty() {
                        return Ok(Value::Null);
                    }
                    if status.is_success() {
                        return serde_json::from_str(&text)
                            .map_err(|e| McpError::Serde(format!("{e}: {text}")));
                    }
                    if should_retry_status(status) && attempts < 3 {
                        sleep(backoff(attempts)).await;
                        continue;
                    }
                    return Err(McpError::http(status.as_u16(), text));
                }
                Err(e) if (e.is_timeout() || e.is_connect()) && attempts < 3 => {
                    sleep(backoff(attempts)).await;
                    continue;
                }
                Err(e) => return Err(McpError::Request(e.to_string())),
            }
        }
    }

    async fn send_with_body(&self, method: reqwest::Method, path: &str, body: &Value) -> McpResult<Value> {
        let mut attempts = 0u8;
        loop {
            attempts += 1;
            let url = self.url(path);
            let req = self
                .http
                .request(method.clone(), &url)
                .headers(self.auth_headers())
                .json(body);
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    if status.is_success() {
                        if text.is_empty() {
                            return Ok(Value::Null);
                        }
                        return serde_json::from_str(&text)
                            .map_err(|e| McpError::Serde(format!("{e}: {text}")));
                    }
                    if should_retry_status(status) && attempts < 3 {
                        sleep(backoff(attempts)).await;
                        continue;
                    }
                    return Err(McpError::http(status.as_u16(), text));
                }
                Err(e) if (e.is_timeout() || e.is_connect()) && attempts < 3 => {
                    sleep(backoff(attempts)).await;
                    continue;
                }
                Err(e) => return Err(McpError::Request(e.to_string())),
            }
        }
    }
}

fn should_retry_status(s: StatusCode) -> bool {
    s.is_server_error() || s.as_u16() == 429
}

fn backoff(attempts: u8) -> Duration {
    let base_ms = 250u64;
    let exp = base_ms * 2u64.saturating_pow((attempts - 1) as u32);
    Duration::from_millis(exp.min(1000))
}
