use axum::{
    body::Bytes,
    extract::{multipart::Multipart, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use weavine_lib::models::Media;

use super::auth::{extract_auth, extract_auth_with_device};

#[derive(Debug, Deserialize)]
pub struct UploadForm {
    pub kind: String,
    pub owner_type: String,
    pub owner_id: String,
}

#[derive(Debug, Serialize)]
pub struct MediaResponse {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub owner_type: String,
    pub owner_id: String,
    pub mime: String,
    pub size_bytes: i64,
    pub sha256: Option<String>,
    pub filename: Option<String>,
}

impl From<Media> for MediaResponse {
    fn from(m: Media) -> Self {
        Self {
            id: m.id,
            user_id: m.user_id,
            kind: m.kind,
            owner_type: m.owner_type,
            owner_id: m.owner_id,
            mime: m.mime,
            size_bytes: m.size_bytes,
            sha256: m.sha256,
            filename: m.filename,
        }
    }
}

fn validate_kind(kind: &str) -> Result<(), (StatusCode, String)> {
    if matches!(kind, "avatar" | "card_image" | "attachment") {
        Ok(())
    } else {
        Err((StatusCode::BAD_REQUEST, format!("invalid kind: {kind}")))
    }
}

async fn ensure_owner_authorized(
    pool: &PgPool,
    user_id: &str,
    owner_type: &str,
    owner_id: &str,
    for_update: bool,
) -> Result<(), (StatusCode, String)> {
    let lock = if for_update { " FOR UPDATE" } else { "" };
    let q = match owner_type {
        "contact" => format!(
            "SELECT user_id FROM contact WHERE id=$1 AND deleted_at IS NULL{lock}"
        ),
        "event" => format!(
            "SELECT user_id FROM event WHERE id=$1 AND deleted_at IS NULL{lock}"
        ),
        "project" => format!(
            "SELECT user_id FROM project WHERE id=$1 AND deleted_at IS NULL{lock}"
        ),
        _ => return Err((StatusCode::BAD_REQUEST, "invalid owner_type".into())),
    };
    let owner: Option<(String,)> = sqlx::query_as(&q)
        .bind(owner_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match owner {
        Some((u,)) if u == user_id => Ok(()),
        Some(_) => Err((StatusCode::FORBIDDEN, "无权访问".into())),
        None => Err((StatusCode::NOT_FOUND, "owner not found".into())),
    }
}

pub async fn upload(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    mut form: Multipart,
) -> Result<axum::Json<MediaResponse>, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;

    let mut kind: Option<String> = None;
    let mut owner_type: Option<String> = None;
    let mut owner_id: Option<String> = None;
    let mut mime: Option<String> = None;
    let mut filename: Option<String> = None;
    let mut blob: Option<Vec<u8>> = None;

    while let Some(field) = form
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "kind" => kind = Some(field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?),
            "owner_type" => owner_type = Some(field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?),
            "owner_id" => owner_id = Some(field.text().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?),
            "file" => {
                mime = field.content_type().map(|m| m.to_string());
                filename = field.file_name().map(|s| s.to_string());
                let bytes: Bytes = field
                    .bytes()
                    .await
                    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
                blob = Some(bytes.to_vec());
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    let kind = kind.ok_or_else(|| (StatusCode::BAD_REQUEST, "missing kind".into()))?;
    let owner_type = owner_type.ok_or_else(|| (StatusCode::BAD_REQUEST, "missing owner_type".into()))?;
    let owner_id = owner_id.ok_or_else(|| (StatusCode::BAD_REQUEST, "missing owner_id".into()))?;
    let mime = mime.unwrap_or_else(|| "application/octet-stream".to_string());
    let blob = blob.ok_or_else(|| (StatusCode::BAD_REQUEST, "missing file".into()))?;

    validate_kind(&kind)?;
    ensure_owner_authorized(&pool, &auth, &owner_type, &owner_id, false).await?;

    let size = blob.len() as i64;
    let sha256 = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&blob);
        Some(format!("{:x}", hasher.finalize()))
    };

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let row: Media = sqlx::query_as(
        "INSERT INTO media (user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, blob) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (user_id, kind, owner_type, owner_id) DO UPDATE SET \
            mime=EXCLUDED.mime, size_bytes=EXCLUDED.size_bytes, sha256=EXCLUDED.sha256, \
            filename=EXCLUDED.filename, blob=EXCLUDED.blob, updated_at=now() \
         RETURNING id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, created_at, updated_at"
    )
    .bind(&auth)
    .bind(&kind)
    .bind(&owner_type)
    .bind(&owner_id)
    .bind(&mime)
    .bind(size)
    .bind(&sha256)
    .bind(&filename)
    .bind(&blob)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(axum::Json(row.into()))
}

pub async fn get_blob(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<impl axum::response::IntoResponse, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let row: Option<(String, String, Vec<u8>)> = sqlx::query_as(
        "SELECT user_id, mime, blob FROM media WHERE id=$1 AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let (owner, mime, blob) = row.ok_or_else(|| (StatusCode::NOT_FOUND, "media not found".into()))?;
    if owner != auth {
        return Err((StatusCode::FORBIDDEN, "无权访问".into()));
    }
    let mut resp_headers = HeaderMap::new();
    resp_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    Ok((resp_headers, blob))
}

pub async fn delete(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let (auth, device_id) = extract_auth_with_device(&headers, pool.as_ref()).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    sqlx::query("SELECT set_config('app.current_device_id', $1, true)")
        .bind(&device_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let row: Option<(String,)> = sqlx::query_as("SELECT user_id FROM media WHERE id=$1 AND deleted_at IS NULL")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let owner = row.ok_or_else(|| (StatusCode::NOT_FOUND, "media not found".into()))?;
    if owner.0 != auth {
        return Err((StatusCode::FORBIDDEN, "无权访问".into()));
    }
    sqlx::query("UPDATE media SET deleted_at=now(), updated_at=now() WHERE id=$1")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tx.commit()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct ListByOwnerQuery {
    pub kind: String,
    pub owner_type: String,
    pub owner_id: String,
}

pub async fn list_by_owner(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    axum::extract::Query(q): axum::extract::Query<ListByOwnerQuery>,
) -> Result<axum::Json<Vec<MediaResponse>>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let rows: Vec<Media> = sqlx::query_as(
        "SELECT id, user_id, kind, owner_type, owner_id, mime, size_bytes, sha256, filename, created_at, updated_at \
         FROM media WHERE user_id=$1 AND kind=$2 AND owner_type=$3 AND owner_id=$4 AND deleted_at IS NULL \
         ORDER BY created_at DESC"
    )
    .bind(&auth)
    .bind(&q.kind)
    .bind(&q.owner_type)
    .bind(&q.owner_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(axum::Json(rows.into_iter().map(MediaResponse::from).collect()))
}