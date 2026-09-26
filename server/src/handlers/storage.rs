use axum::{
    body::Body,
    extract::Path,
    http::{header, HeaderMap, HeaderValue, Response, StatusCode},
};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tokio::fs;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct StorageKey(pub String);

#[async_trait::async_trait]
pub trait Storage: Send + Sync {
    async fn put(
        &self,
        user_id: &str,
        kind: &str,
        owner_type: &str,
        owner_id: &str,
        mime_hint: &str,
        bytes: &[u8],
    ) -> Result<StorageKey, String>;

    async fn delete(&self, user_id: &str, key: &StorageKey) -> Result<(), String>;

    async fn get_response(
        &self,
        key: &StorageKey,
        mime: &str,
    ) -> Result<Response<Body>, (StatusCode, String)>;
}

pub struct LocalFsStorage {
    root: PathBuf,
}

impl LocalFsStorage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path_for(&self, key: &StorageKey) -> PathBuf {
        // Keys are minted as
        // `{user_id}/{kind}/{owner_type}/{owner_id}/{sha}-{uuid}.{ext}` and
        // are the only values that may reach the filesystem; anything with
        // traversal segments, separators or absolute-path components is
        // rejected before join().
        let key = &key.0;
        if key.is_empty()
            || key.starts_with('/')
            || key.starts_with("\\")
            || key.contains("\\")
            || key.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
        {
            return self.root.clone();
        }
        self.root.join(key)
    }
}

#[async_trait::async_trait]
impl Storage for LocalFsStorage {
    async fn put(
        &self,
        user_id: &str,
        kind: &str,
        owner_type: &str,
        owner_id: &str,
        mime_hint: &str,
        bytes: &[u8],
    ) -> Result<StorageKey, String> {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let sha = format!("{:x}", hasher.finalize());
        let ext = match mime_hint {
            "image/png" => "png",
            "image/jpeg" | "image/jpg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => "bin",
        };
        let key = format!(
            "{user_id}/{kind}/{owner_type}/{owner_id}/{}-{}.{ext}",
            &sha[..16],
            Uuid::new_v4()
        );
        let path = self.path_for(&StorageKey(key.clone()));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        fs::write(&path, bytes).await.map_err(|e| e.to_string())?;
        eprintln!("[storage-put] wrote {} bytes -> {}", bytes.len(), path.display());
        Ok(StorageKey(key))
    }

    async fn delete(&self, _user_id: &str, key: &StorageKey) -> Result<(), String> {
        let path = self.path_for(key);
        match fs::remove_file(&path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    async fn get_response(
        &self,
        key: &StorageKey,
        mime: &str,
    ) -> Result<Response<Body>, (StatusCode, String)> {
        let path = self.path_for(key);
        let bytes = fs::read(&path)
            .await
            .map_err(|_| (StatusCode::NOT_FOUND, "not found".into()))?;
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(mime)
                .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
        );
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400, immutable"),
        );
        let mut resp = Response::builder().status(StatusCode::OK);
        for (k, v) in headers {
            resp = resp.header(k.unwrap(), v);
        }
        Ok(resp.body(Body::from(bytes)).unwrap())
    }
}

pub async fn serve_file(
    Path(key): Path<String>,
    axum::Extension(storage): axum::Extension<Arc<dyn Storage>>,
) -> Result<Response<Body>, (StatusCode, String)> {
    if key.is_empty()
        || key.starts_with('/')
        || key.contains("\\")
        || key.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return Err((StatusCode::BAD_REQUEST, "invalid storage key".into()));
    }
    let ext = key.rsplit('.').next().unwrap_or("bin");
    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };
    // `key` arrives from a public route (no auth on `/files/*`) and is otherwise
    // only length-checked by the validator above, so clamp it before logging —
    // same reasoning as `log_requests`.
    eprintln!(
        "[serve-file] GET key={} mime={mime}",
        crate::truncate_for_log(&key, crate::LOG_URI_MAX_CHARS)
    );
    storage.get_response(&StorageKey(key), mime).await
}