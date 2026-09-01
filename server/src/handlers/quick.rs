use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::extract_auth;
use weavine_lib::models::Contact;
use weavine_lib::quick::{parse as quick_parse, QuickItem};

#[derive(Deserialize)]
pub struct ParseReq {
    pub text: String,
    #[serde(default)]
    pub contact_names: Vec<String>,
}

pub async fn parse(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(req): Json<ParseReq>,
) -> Result<Json<QuickItem>, (StatusCode, String)> {
    let auth = extract_auth(&headers, &pool).await?;

    let contacts: Vec<Contact> = if !req.contact_names.is_empty() {
        // Scope contact lookup to the caller's user_id. Without this, any
        // authenticated user could pass a nickname that exists on another
        // account and have it resolved into a foreign contact_id in the
        // parser response (cross-user nickname撞库).
        sqlx::query_as::<_, Contact>(
            "SELECT id, user_id, nickname, name, company, title, address, email, phone, wechat, \
             importance, last_interaction_at, keep_in_touch_cadence_days, \
             created_at, updated_at, \
             avatar_storage_key, avatar_mime, avatar_width::BIGINT AS avatar_width, \
             avatar_height::BIGINT AS avatar_height, avatar_alt_text \
             FROM contact WHERE user_id = $1 AND nickname = ANY($2)",
        )
        .bind(&auth)
        .bind(&req.contact_names)
        .fetch_all(&*pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        Vec::new()
    };

    let item = quick_parse(&req.text, &contacts, Utc::now());
    Ok(Json(item))
}