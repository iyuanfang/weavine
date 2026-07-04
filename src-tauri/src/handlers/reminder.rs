use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use crate::AppState;
use weavine_lib::{
    business,
    models::{CreateReminderInput, Reminder, UpdateReminderInput},
};

#[derive(Deserialize)]
pub struct ListParams {
    pub user_id: String,
    pub contact_id: Option<String>,
    pub event_id: Option<String>,
    pub include_dismissed: Option<bool>,
    pub limit: Option<i64>,
}

pub async fn list(
    State(s): State<AppState>,
    Query(p): Query<ListParams>,
) -> Result<Json<Vec<Reminder>>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::reminder::list(
        &conn,
        &p.user_id,
        p.contact_id.as_deref(),
        p.event_id.as_deref(),
        p.include_dismissed,
        p.limit,
    )
    .map(Json)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<CreateReminderInput>,
) -> Result<Json<Reminder>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::reminder::create(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(mut input): Json<UpdateReminderInput>,
) -> Result<Json<Reminder>, (StatusCode, String)> {
    input.id = id;
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::reminder::update(&conn, &input)
        .map(Json)
        .map_err(|e| crate::handlers::http_err::for_create_or_update(&e))
}

pub async fn delete(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::reminder::delete(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

pub async fn dismiss(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let conn = s.db.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    business::reminder::dismiss(&conn, &id)
        .map(|_| Json(()))
        .map_err(|e| crate::handlers::http_err::for_get(&e))
}
