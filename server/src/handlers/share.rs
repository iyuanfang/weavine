// Per-item sharing for notes & events (docs/design/share-feature.md).
//
// Snapshot model: creating a share copies the entity's current title/content
// into share_link — the public page and mini-program never touch the live
// note/event tables. The owner refreshes the snapshot explicitly; revocation
// cuts access instantly (revoked_at filters every public read).
//
// Public endpoints are rate-limited per IP: the token is a capability, but a
// leaked token must not become a free read/write API.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use std::sync::Arc;

use super::auth::{client_ip, extract_auth, ocr_voice_rate_limit, OCR_VOICE_RL_WINDOW};
use super::now_str;
use std::time::Duration;

const SHARE_RL_LIMIT: usize = 120;
const SHARE_RL_WINDOW: Duration = Duration::from_secs(60);

fn rate_limit() -> &'static crate::rate_limit::RateLimiter {
    ocr_voice_rate_limit()
}

fn base_url() -> String {
    std::env::var("WEAVINE_PUBLIC_BASE_URL")
        .unwrap_or_else(|_| "https://www.weavine.com".to_string())
}

fn share_url(token: &str) -> String {
    format!("{}/s/{}", base_url().trim_end_matches('/'), token)
}

#[derive(serde::Serialize)]
pub struct ShareInfo {
    pub token: String,
    pub url: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub view_count: i64,
    pub revoked: bool,
}

type ShareRow = (String, String, String, String, i64, Option<String>);

fn share_info(row: ShareRow) -> ShareInfo {
    let (token, entity_type, entity_id, title, view_count, revoked_at) = row;
    ShareInfo {
        url: share_url(&token),
        token,
        entity_type,
        entity_id,
        title,
        view_count,
        revoked: revoked_at.is_some(),
    }
}

const SHARE_ROW_COLS: &str =
    "token, entity_type, entity_id, title, view_count, revoked_at";

#[derive(Deserialize)]
pub struct CreateShareReq {
    pub entity_type: String,
    pub entity_id: String,
}

/// Snapshot the entity's current content (title + markdown text + event
/// fields). Returns None when the entity doesn't exist for this user.
async fn snapshot(
    pool: &PgPool,
    entity_type: &str,
    entity_id: &str,
    user_id: &str,
) -> Result<Option<(String, String, Option<String>, Option<String>, Option<String>)>, (StatusCode, String)> {
    match entity_type {
        "note" => {
            let row: Option<(String, String)> = sqlx::query_as(
                "SELECT title, body FROM note \
                 WHERE id = $1 AND user_id = $2 AND archived_at IS NULL AND deleted_at IS NULL",
            )
            .bind(entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("snapshot note: {e}")))?;
            Ok(row.map(|(title, body)| (title, body, None, None, None)))
        }
        "event" => {
            let row: Option<(String, Option<String>, String, Option<String>)> = sqlx::query_as(
                "SELECT title, description, start_at, location FROM event \
                 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
            )
            .bind(entity_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("snapshot event: {e}")))?;
            Ok(row.map(|(title, description, start_at, location)| {
                let content = description.unwrap_or_default();
                (title, content, Some(start_at), None, location)
            }))
        }
        _ => Err((StatusCode::BAD_REQUEST, "entity_type 仅支持 note / event".into())),
    }
}

/// Creates (or returns the existing active) share link for one entity.
/// Reusing the active link means re-sharing to the group is the same URL —
/// no orphaned tokens.
pub async fn create(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Json(body): Json<CreateShareReq>,
) -> Result<Json<ShareInfo>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    if !matches!(body.entity_type.as_str(), "note" | "event") {
        return Err((StatusCode::BAD_REQUEST, "entity_type 仅支持 note / event".into()));
    }

    let existing: Option<ShareRow> = sqlx::query_as(&format!(
        "SELECT {SHARE_ROW_COLS} FROM share_link \
         WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3 AND revoked_at IS NULL"
    ))
    .bind(&body.entity_type)
    .bind(&body.entity_id)
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    if let Some(row) = existing {
        return Ok(Json(share_info(row)));
    }

    let (title, content, event_start, event_end, event_location) =
        snapshot(&pool, &body.entity_type, &body.entity_id, &user_id).await?
            .ok_or((StatusCode::NOT_FOUND, "实体不存在".into()))?;

    let token = uuid::Uuid::new_v4().simple().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_str();
    sqlx::query(
        "INSERT INTO share_link (id, token, user_id, entity_type, entity_id, title, content, \
         event_start, event_end, event_location, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(&id)
    .bind(&token)
    .bind(&user_id)
    .bind(&body.entity_type)
    .bind(&body.entity_id)
    .bind(&title)
    .bind(&content)
    .bind(&event_start)
    .bind(&event_end)
    .bind(&event_location)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("insert: {e}")))?;

    Ok(Json(ShareInfo {
        url: share_url(&token),
        token,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        title,
        view_count: 0,
        revoked: false,
    }))
}

/// Re-shares with a fresh snapshot (owner edited the note/event after the
/// first share and wants the public page to catch up).
pub async fn refresh(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
) -> Result<Json<ShareInfo>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let row: Option<(String, String, String, i64, Option<String>)> = sqlx::query_as(&format!(
        "SELECT entity_type, entity_id, title, view_count, revoked_at FROM share_link \
         WHERE token = $1 AND user_id = $2"
    ))
    .bind(&token)
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    let (entity_type, entity_id, _old_title, view_count, revoked_at) =
        row.ok_or((StatusCode::NOT_FOUND, "分享不存在".into()))?;
    if revoked_at.is_some() {
        return Err((StatusCode::GONE, "分享已撤销".into()));
    }

    let (title, content, event_start, event_end, event_location) =
        snapshot(&pool, &entity_type, &entity_id, &user_id).await?
            .ok_or((StatusCode::NOT_FOUND, "原实体已删除".into()))?;

    sqlx::query(
        "UPDATE share_link SET title = $1, content = $2, event_start = $3, event_end = $4, \
         event_location = $5 WHERE token = $6 AND user_id = $7",
    )
    .bind(&title)
    .bind(&content)
    .bind(&event_start)
    .bind(&event_end)
    .bind(&event_location)
    .bind(&token)
    .bind(&user_id)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("update: {e}")))?;

    Ok(Json(ShareInfo {
        url: share_url(&token),
        token,
        entity_type,
        entity_id,
        title,
        view_count,
        revoked: false,
    }))
}

/// Revokes the link — the public page and API go 404 immediately.
pub async fn revoke(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let now = now_str();
    let result = sqlx::query(
        "UPDATE share_link SET revoked_at = $1 \
         WHERE token = $2 AND user_id = $3 AND revoked_at IS NULL",
    )
    .bind(&now)
    .bind(&token)
    .bind(&user_id)
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("revoke: {e}")))?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "分享不存在或已撤销".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Owner-side stats: view count + RSVP responses.
pub async fn owner_meta(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let user_id = extract_auth(&headers, pool.as_ref()).await?;
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT title, view_count FROM share_link WHERE token = $1 AND user_id = $2",
    )
    .bind(&token)
    .bind(&user_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))?;
    let (title, view_count) = row.ok_or((StatusCode::NOT_FOUND, "分享不存在".into()))?;
    let rsvps: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT name, response, created_at FROM share_rsvp \
         WHERE token = $1 ORDER BY created_at ASC",
    )
    .bind(&token)
    .fetch_all(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rsvps: {e}")))?;
    let rsvps: Vec<serde_json::Value> = rsvps
        .into_iter()
        .map(|(name, response, created_at)| {
            serde_json::json!({ "name": name, "response": response, "at": created_at })
        })
        .collect();
    Ok(Json(serde_json::json!({
        "title": title,
        "viewCount": view_count,
        "rsvps": rsvps,
    })))
}

// ── Public (no auth, IP rate-limited) ───────────────────────────────────

fn check_public_rl(headers: &HeaderMap, peer: Option<std::net::SocketAddr>) -> bool {
    let ip = client_ip(headers, peer);
    rate_limit().check("share", "ip", &ip, SHARE_RL_LIMIT, SHARE_RL_WINDOW)
}

type PublicRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    Option<String>,
);

async fn load_public(
    pool: &PgPool,
    token: &str,
) -> Result<Option<PublicRow>, (StatusCode, String)> {
    sqlx::query_as(
        "SELECT entity_type, title, content, event_start, event_end, event_location, \
         view_count, revoked_at FROM share_link WHERE token = $1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("query: {e}")))
}

/// Public JSON — consumed by the mini-program and any embedder.
pub async fn public_get(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if !check_public_rl(&headers, None) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "请求过于频繁".into()));
    }
    let (entity_type, title, content, start, end, location, mut views, revoked) =
        load_public(&pool, &token)
            .await?
            .ok_or((StatusCode::NOT_FOUND, "分享不存在".into()))?;
    if revoked.is_some() {
        return Err((StatusCode::NOT_FOUND, "分享已撤销".into()));
    }
    views += 1;
    let _ = sqlx::query("UPDATE share_link SET view_count = $1 WHERE token = $2")
        .bind(views)
        .bind(&token)
        .execute(&*pool)
        .await;
    Ok(Json(serde_json::json!({
        "type": entity_type,
        "title": title,
        "content": content,
        "start": start,
        "end": end,
        "location": location,
        "viewCount": views,
    })))
}

#[derive(Deserialize)]
pub struct RsvpReq {
    pub name: String,
    pub response: String,
}

/// Anonymous RSVP — no account, just a name and a choice.
pub async fn public_rsvp(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
    Json(body): Json<RsvpReq>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if !check_public_rl(&headers, None) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "请求过于频繁".into()));
    }
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err((StatusCode::BAD_REQUEST, "称呼需为 1–40 字".into()));
    }
    if !matches!(body.response.as_str(), "yes" | "maybe" | "no") {
        return Err((StatusCode::BAD_REQUEST, "response 仅支持 yes / maybe / no".into()));
    }
    let (entity_type, _title, _content, _s, _e, _l, _v, revoked) = load_public(&pool, &token)
        .await?
        .ok_or((StatusCode::NOT_FOUND, "分享不存在".into()))?;
    if revoked.is_some() {
        return Err((StatusCode::NOT_FOUND, "分享已撤销".into()));
    }
    if entity_type != "event" {
        return Err((StatusCode::BAD_REQUEST, "仅日程邀请可回应".into()));
    }
    sqlx::query(
        "INSERT INTO share_rsvp (id, token, name, response, created_at) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&token)
    .bind(name)
    .bind(&body.response)
    .bind(now_str())
    .execute(&*pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("rsvp: {e}")))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Server-rendered public page (mobile-first, no JS bundle) — the WeChat
/// in-browser surface. Value first: the content IS the page; the brand row
/// and CTA sit after it. Peers: docs/design/share-feature.md §5.
pub async fn public_page(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Path(token): Path<String>,
) -> axum::response::Response {
    if !check_public_rl(&headers, None) {
        return html_response(StatusCode::TOO_MANY_REQUESTS, "请求过于频繁".into());
    }
    let (entity_type, title, content, start, end, location, views, revoked) =
        match load_public(&pool, &token).await {
            Ok(Some(row)) => row,
            Ok(None) => return html_response(StatusCode::NOT_FOUND, not_found_page()),
            Err((code, msg)) => return html_response(code, msg),
        };
    if revoked.is_some() {
        return html_response(StatusCode::NOT_FOUND, not_found_page());
    }
    let _ = sqlx::query("UPDATE share_link SET view_count = view_count + 1 WHERE token = $1")
        .bind(&token)
        .execute(&*pool)
        .await;

    let kind_label = if entity_type == "event" { "日程邀请" } else { "笔记分享" };

    let event_block = if entity_type == "event" {
        let when = match (&start, &end) {
            (Some(s), Some(e)) => format!("{} ~ {}", esc(s), esc(e)),
            (Some(s), None) => esc(s),
            _ => String::new(),
        };
        let loc = location
            .as_ref()
            .map(|l| format!("<div class=\"row\">📍 {}</div>", esc(l)))
            .unwrap_or_default();
        let rsvp = format!(
            "<div class=\"rsvp\">\
               <div class=\"rsvp__title\">回应邀请</div>\
               <input id=\"rsvp-name\" placeholder=\"你的称呼\" maxlength=\"40\" />\
               <div class=\"rsvp__btns\">\
                 <button data-r=\"yes\" onclick=\"rsvp('yes')\">参加</button>\
                 <button data-r=\"maybe\" onclick=\"rsvp('maybe')\">可能</button>\
                 <button data-r=\"no\" onclick=\"rsvp('no')\">不去</button>\
               </div>\
               <div id=\"rsvp-done\" class=\"rsvp__done\" hidden>已回应，谢谢！</div>\
             </div>\
             <script>\
               function rsvp(r) {{\
                 var n = document.getElementById('rsvp-name').value.trim();\
                 if (!n) {{ alert('请先填写称呼'); return; }}\
                 fetch('/api/public/share/{token}/rsvp', {{\
                   method: 'POST',\
                   headers: {{'Content-Type': 'application/json'}},\
                   body: JSON.stringify({{ name: n, response: r }})\
                 }}).then(function(res) {{\
                   if (res.ok) {{\
                     document.querySelector('.rsvp__btns').style.display = 'none';\
                     document.getElementById('rsvp-done').hidden = false;\
                   }} else {{ res.text().then(function(t) {{ alert(t || '失败'); }}); }}\
                 }});\
               }}\
             </script>",
            token = token
        );
        format!(
            "<div class=\"event-meta\">\
               <div class=\"row\">🕒 {}</div>{}\
             </div>{}",
            when,
            loc,
            rsvp
        )
    } else {
        String::new()
    };

    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="{kind_label} · 织遇 Weavine">
<style>
  body {{ margin:0; background:#f5f6f8; color:#1a1d29;
         font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }}
  .wrap {{ max-width:560px; margin:0 auto; padding:20px 16px 40px; }}
  .kind {{ display:inline-block; font-size:12px; color:#6b7280;
           border:1px solid #d1d5db; border-radius:6px; padding:2px 8px; margin-bottom:12px; }}
  h1 {{ font-size:22px; line-height:1.4; margin:0 0 16px; }}
  .card {{ background:#fff; border-radius:14px; padding:20px 18px;
           box-shadow:0 1px 4px rgba(0,0,0,.06); }}
  .content {{ white-space:pre-wrap; word-break:break-word; font-size:15px;
              line-height:1.7; }}
  .event-meta .row {{ font-size:14px; color:#4b5563; margin:4px 0; }}
  .rsvp {{ margin-top:18px; border-top:1px solid #eee; padding-top:16px; }}
  .rsvp__title {{ font-size:14px; font-weight:600; margin-bottom:10px; }}
  .rsvp input {{ width:100%; box-sizing:border-box; padding:10px 12px; font-size:15px;
                 border:1px solid #d1d5db; border-radius:8px; margin-bottom:10px; }}
  .rsvp__btns {{ display:flex; gap:8px; }}
  .rsvp__btns button {{ flex:1; padding:10px 0; font-size:14px; border-radius:8px;
                        border:1px solid #d1d5db; background:#fff; color:#1a1d29; }}
  .rsvp__btns button[data-r="yes"] {{ background:#059669; border-color:#059669; color:#fff; }}
  .rsvp__done {{ color:#059669; font-size:14px; text-align:center; }}
  .brand {{ margin-top:28px; text-align:center; font-size:13px; color:#9ca3af; }}
  .brand a {{ color:#059669; text-decoration:none; font-weight:600; }}
  .views {{ text-align:center; font-size:12px; color:#c0c4cc; margin-top:8px; }}
</style>
</head>
<body>
<div class="wrap">
  <span class="kind">{kind_label}</span>
  <h1>{title}</h1>
  <div class="card">
    {event_block}
    <div class="content">{content}</div>
  </div>
  <div class="brand">由 <a href="/">织遇 Weavine</a> 记录 · 编织遇见的人脉</div>
  <div class="views">{views} 次浏览</div>
</div>
</body>
</html>"#,
        title = esc(&title),
        kind_label = kind_label,
        event_block = event_block,
        content = esc(&content),
        views = views + 1,
    );

    html_response(StatusCode::OK, html)
}

fn html_response(status: StatusCode, body: String) -> axum::response::Response {
    use axum::response::IntoResponse;
    (
        status,
        [
            (axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

fn page_headers() -> [(axum::http::header::HeaderName, &'static str); 2] {
    use axum::http::header;
    [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-store")]
}

fn not_found_page() -> String {
    r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>分享不存在</title>
<style>body{margin:0;background:#f5f6f8;color:#6b7280;font-family:-apple-system,"PingFang SC",sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;}</style></head>
<body><div style="text-align:center"><div style="font-size:40px">🔗</div>
<p>该分享不存在或已被撤销</p></div></body></html>"#
        .to_string()
}
