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
    pub install_id: String,
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
    /// Device asking for changes. The server skips rows this same device
    /// authored, since it already holds them — it wrote them. `sync_once`
    /// pushes and pulls in one cycle, so without this every upload comes
    /// straight back and is replayed through `apply_change` row by row.
    ///
    /// `skip_serializing_if` keeps the body byte-identical to the pre-2026-09-26
    /// request when there is no device to name, so an older server parses it
    /// unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
}

#[derive(Deserialize)]
pub struct PullResp {
    pub rows: Vec<ChangeRow>,
    pub latest_revision: i64,
    pub has_more: bool,
    /// Highest revision the server has already pruned out of the change log.
    ///
    /// If our cursor sits below this, the changelog has a hole we can never
    /// read, so the incremental stream cannot bring us up to date — we have to
    /// bootstrap from `snapshot` instead. Older servers don't send the field,
    /// hence the `serde(default)`.
    #[serde(default)]
    pub pruned_through_revision: i64,
}

#[derive(Serialize)]
pub struct SnapshotReq {
    pub kind: String,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct SnapshotResp {
    pub kind: String,
    pub rows: Vec<Value>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    /// The server's change-log head, sampled before the first row was read.
    pub server_revision: i64,
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

#[derive(Deserialize, Serialize, Debug, Clone)]
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

/// POST /api/media — multipart binary upload (avatar/attachment bytes).
/// The server upserts on (user_id, kind, owner_type, owner_id), so repeated
/// uploads for the same avatar converge on one server row whose storage_key
/// is server-authoritative. Returns the server's MediaResponse JSON.
pub async fn upload_media_bytes(
    server_url: &str,
    access_token: &str,
    kind: &str,
    owner_type: &str,
    owner_id: &str,
    mime: &str,
    filename: &str,
    bytes: Vec<u8>,
) -> anyhow::Result<Value> {
    let c = client()?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .mime_str(mime)
        .map_err(|e| anyhow::anyhow!("mime {}: {e}", mime))?
        .file_name(filename.to_string());
    let form = reqwest::multipart::Form::new()
        .text("kind", kind.to_string())
        .text("owner_type", owner_type.to_string())
        .text("owner_id", owner_id.to_string())
        .part("file", part);
    let resp = c
        .post(format!(
            "{}/api/media",
            server_url.trim_end_matches('/')
        ))
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(anyhow::anyhow!("media upload failed ({}): {}", status, snippet));
    }
    Ok(serde_json::from_str(&text)?)
}

/// GET /api/media/:id/blob — download the bytes for a media row.
/// The server 302-redirects to /files/{storage_key}; reqwest follows it.
pub async fn get_media_blob(
    server_url: &str,
    access_token: &str,
    media_id: &str,
) -> anyhow::Result<Vec<u8>> {
    let c = client()?;
    let resp = c
        .get(format!(
            "{}/api/media/{}/blob",
            server_url.trim_end_matches('/'),
            media_id
        ))
        .bearer_auth(access_token)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(anyhow::anyhow!("media blob fetch failed ({})", status));
    }
    Ok(resp.bytes().await?.to_vec())
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
            install_id: crate::install_id::get_or_create(),
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
///
/// `device_id` names this device so the server can leave out the changes it
/// authored itself — see `PullReq::device_id`. Pass `None` when the local
/// install has no device id yet; the server then serves everything, which is
/// the pre-2026-09-26 behaviour.
pub async fn pull(
    server_url: &str,
    access_token: &str,
    since_revision: i64,
    limit: i64,
    device_id: Option<&str>,
) -> anyhow::Result<PullResp> {
    let c = client()?;
    let resp = c
        .post(format!("{}/api/sync/pull", server_url.trim_end_matches('/')))
        .bearer_auth(access_token)
        .json(&PullReq {
            since_revision,
            limit: Some(limit),
            device_id: device_id.map(|s| s.to_string()),
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

/// POST /api/sync/snapshot — one page of current state for a single entity kind.
///
/// Used instead of replaying the changelog from revision 0: the log holds one
/// row per historical edit, so `since_revision = 0` costs O(edits ever made)
/// while the snapshot costs O(rows). On a real account that is the difference
/// between minutes and seconds for a first sync on a phone.
pub async fn snapshot(
    server_url: &str,
    access_token: &str,
    kind: &str,
    cursor: Option<String>,
    limit: i64,
) -> anyhow::Result<SnapshotResp> {
    let c = client()?;
    let resp = c
        .post(format!(
            "{}/api/sync/snapshot",
            server_url.trim_end_matches('/')
        ))
        .bearer_auth(access_token)
        .json(&SnapshotReq {
            kind: kind.to_string(),
            cursor,
            limit: Some(limit),
        })
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("snapshot failed ({}): {}", status, text));
    }
    Ok(resp.json::<SnapshotResp>().await?)
}
