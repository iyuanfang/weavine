use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::{SearchResults, Contact, Interaction, Event, Action, Project, Note};

#[derive(Deserialize)]
pub struct QueryParams {
    pub q: String,
    pub user_id: Option<String>,
}

pub async fn query(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<QueryParams>,
) -> Result<Json<SearchResults>, (StatusCode, String)> {
    let auth = extract_auth(&headers, pool.as_ref()).await?;
    let pattern = format!("%{}%", p.q);

    let contacts = sqlx::query_as::<_, Contact>(
        "SELECT id, user_id, nickname, name, company, title, address, email, phone, wechat, \
                importance, last_interaction_at, keep_in_touch_cadence_days, \
                created_at, updated_at, avatar_storage_key, avatar_mime, \
                avatar_width::BIGINT AS avatar_width, avatar_height::BIGINT AS avatar_height, avatar_alt_text \
         FROM contact WHERE user_id = $1 AND (nickname ILIKE $2 OR name ILIKE $2 OR company ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let interactions = sqlx::query_as::<_, Interaction>(
        "SELECT i.id, i.user_id, i.contact_id, i.action_id, i.event_id, i.occurred_at, i.channel, i.summary, \
                i.source, i.source_ref, i.created_at, c.nickname AS contact_nickname \
         FROM interaction i \
         LEFT JOIN contact c ON c.id = i.contact_id AND c.user_id = i.user_id \
         WHERE i.user_id = $1 AND (i.summary ILIKE $2 OR i.channel ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let events = sqlx::query_as::<_, Event>(
        "SELECT e.id, e.user_id, e.title, e.event_type, e.start_at, e.end_at, e.location, \
                e.contact_id, e.project_id, e.reminder_lead_minutes::BIGINT AS reminder_lead_minutes, \
                e.archived_at, e.created_at, e.updated_at, \
                c.nickname AS contact_nickname, p.title AS project_title \
         FROM event e \
         LEFT JOIN contact c ON c.id = e.contact_id AND c.user_id = e.user_id \
         LEFT JOIN project p ON p.id = e.project_id AND p.user_id = e.user_id \
         WHERE e.user_id = $1 AND (e.title ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let actions = sqlx::query_as::<_, Action>(
        "SELECT a.id, a.user_id, a.title, a.status, a.priority::BIGINT AS priority, \
                a.category, a.due_at, a.contact_id, a.project_id, a.completed_at, a.archived_at, \
                a.created_at, a.updated_at, \
                c.nickname AS contact_nickname, p.title AS project_title \
         FROM action a \
         LEFT JOIN contact c ON c.id = a.contact_id AND c.user_id = a.user_id \
         LEFT JOIN project p ON p.id = a.project_id AND p.user_id = a.user_id \
         WHERE a.user_id = $1 AND (a.title ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let projects = sqlx::query_as::<_, Project>(
        "SELECT id, user_id, title, template, stage, \
                start_at, due_at, completed_at, archived_at, created_at, updated_at \
         FROM project WHERE user_id = $1 AND (title ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let notes = sqlx::query_as::<_, Note>(
        "SELECT id, user_id, title, body, archived_at, created_at, updated_at \
         FROM note WHERE user_id = $1 AND archived_at IS NULL \
           AND (title ILIKE $2 OR body ILIKE $2) \
         ORDER BY updated_at DESC LIMIT 50",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    Ok(Json(SearchResults { contacts, interactions, events, actions, projects, notes }))
}
