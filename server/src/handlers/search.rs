use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use super::auth::extract_auth;
use weavine_lib::models::{SearchResults, Contact, Interaction, Event, Action, Project};

#[derive(Deserialize)]
pub struct QueryParams {
    pub q: String,
    pub owner_id: Option<String>,
}

pub async fn query(
    headers: HeaderMap,
    State(pool): State<Arc<PgPool>>,
    Query(p): Query<QueryParams>,
) -> Result<Json<SearchResults>, (StatusCode, String)> {
    let auth = extract_auth(&headers)?;
    let pattern = format!("%{}%", p.q);

    let contacts = sqlx::query_as::<_, Contact>(
        "SELECT id, owner_id, nickname, name, company, title, city, email, phone, wechat, \
                notes, importance, reminder_enabled, reminder_interval_days, last_contacted_at, \
                created_at, updated_at \
         FROM contact WHERE owner_id = $1 AND (nickname ILIKE $2 OR name ILIKE $2 OR company ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let interactions = sqlx::query_as::<_, Interaction>(
        "SELECT id, owner_id, contact_id, action_id, event_id, occurred_at, channel, summary, created_at \
         FROM interaction WHERE owner_id = $1 AND (summary ILIKE $2 OR channel ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let events = sqlx::query_as::<_, Event>(
        "SELECT id, owner_id, title, event_type, start_at, end_at, location, notes, \
                contact_id, project_id, reminder_lead_minutes, archived_at, created_at, updated_at \
         FROM event WHERE owner_id = $1 AND (title ILIKE $2 OR notes ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let actions = sqlx::query_as::<_, Action>(
        "SELECT id, owner_id, title, description, status, priority, category, due_at, \
                contact_id, project_id, completed_at, archived_at, created_at, updated_at \
         FROM action WHERE owner_id = $1 AND (title ILIKE $2 OR description ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    let projects = sqlx::query_as::<_, Project>(
        "SELECT id, owner_id, title, description, template, stage, \
                start_at, due_at, completed_at, archived_at, created_at, updated_at \
         FROM project WHERE owner_id = $1 AND (title ILIKE $2 OR description ILIKE $2)",
    )
    .bind(&auth).bind(&pattern)
    .fetch_all(&*pool).await.unwrap_or_default();

    Ok(Json(SearchResults { contacts, interactions, events, actions, projects }))
}
