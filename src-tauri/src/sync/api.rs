use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Request / Response types matching the server's sync API contract
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
    pub device: DeviceInfo,
}

#[derive(Serialize)]
pub struct DeviceInfo {
    pub name: String,
    pub os: String,
    pub app_version: String,
}

#[derive(Deserialize)]
pub struct LoginResp {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub device_id: String,
}

#[derive(Serialize)]
pub struct RefreshReq {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct RefreshResp {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
pub struct ManifestResp {
    pub schema_version: i32,
    pub server_revision: i64,
    pub last_updated: Option<String>,
}

#[derive(Serialize)]
pub struct PullReq {
    pub since_revision: i64,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct PullResp {
    pub rows: Vec<ChangeRow>,
    pub latest_revision: i64,
    pub has_more: bool,
}

#[derive(Deserialize)]
pub struct ChangeRow {
    pub kind: String,
    pub op: String,
    pub row_id: String,
    pub data: Option<Value>,
    pub revision: i64,
}

#[derive(Serialize)]
pub struct PushReq {
    pub device_id: String,
    pub entities: Vec<EntityPush>,
}

#[derive(Serialize)]
pub struct EntityPush {
    pub kind: String,
    pub rows: Vec<Value>,
}

#[derive(Deserialize)]
pub struct PushResp {
    pub accepted: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub server_revision: i64,
}

#[derive(Deserialize)]
pub struct Conflict {
    pub kind: String,
    pub row_id: String,
    pub reason: String,
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("weavine-desktop/0.1.8")
        .build()
}

/// POST /api/auth/login
pub async fn login(server_url: &str, email: &str, password: &str) -> anyhow::Result<LoginResp> {
    let c = client()?;
    let body = LoginReq {
        email: email.to_string(),
        password: password.to_string(),
        device: DeviceInfo {
            name: "Weavine Desktop".to_string(),
            os: std::env::consts::OS.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        },
    };
    let resp = c
        .post(format!("{}/api/auth/login", server_url.trim_end_matches('/')))
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("login failed ({}): {}", status, text));
    }
    Ok(resp.json::<LoginResp>().await?)
}

/// POST /api/auth/refresh
pub async fn refresh_token(
    server_url: &str,
    refresh_tok: &str,
) -> anyhow::Result<RefreshResp> {
    let c = client()?;
    let resp = c
        .post(format!("{}/api/auth/refresh", server_url.trim_end_matches('/')))
        .json(&RefreshReq {
            refresh_token: refresh_tok.to_string(),
        })
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("refresh failed ({}): {}", status, text));
    }
    Ok(resp.json::<RefreshResp>().await?)
}

/// POST /api/sync/manifest
pub async fn manifest(
    server_url: &str,
    access_token: &str,
) -> anyhow::Result<ManifestResp> {
    let c = client()?;
    let resp = c
        .post(format!("{}/api/sync/manifest", server_url.trim_end_matches('/')))
        .bearer_auth(access_token)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("manifest failed ({}): {}", status, text));
    }
    Ok(resp.json::<ManifestResp>().await?)
}

/// POST /api/sync/pull
pub async fn pull(
    server_url: &str,
    access_token: &str,
    since_revision: i64,
    limit: i64,
) -> anyhow::Result<PullResp> {
    let c = client()?;
    let resp = c
        .post(format!("{}/api/sync/pull", server_url.trim_end_matches('/')))
        .bearer_auth(access_token)
        .json(&PullReq {
            since_revision,
            limit: Some(limit),
        })
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("pull failed ({}): {}", status, text));
    }
    Ok(resp.json::<PullResp>().await?)
}

/// POST /api/sync/push
pub async fn push(
    server_url: &str,
    access_token: &str,
    device_id: &str,
    entities: Vec<EntityPush>,
) -> anyhow::Result<PushResp> {
    let c = client()?;
    let resp = c
        .post(format!("{}/api/sync/push", server_url.trim_end_matches('/')))
        .bearer_auth(access_token)
        .json(&PushReq {
            device_id: device_id.to_string(),
            entities,
        })
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("push failed ({}): {}", status, text));
    }
    Ok(resp.json::<PushResp>().await?)
}
